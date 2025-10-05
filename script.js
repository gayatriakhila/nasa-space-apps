// --- 1. FIREBASE SETUP (Mandatory for persistence and user ID) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// IMPORTANT: Use provided global variables or fallbacks
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let db, auth, userId = 'loading...';
let isAuthReady = false;

if (firebaseConfig) {
    // setLogLevel('debug'); // Uncomment for debugging
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            try {
                if (initialAuthToken) {
                    const userCredential = await signInWithCustomToken(auth, initialAuthToken);
                    userId = userCredential.user.uid;
                } else {
                    const userCredential = await signInAnonymously(auth);
                    userId = userCredential.user.uid;
                }
            } catch (error) {
                console.error("Firebase Auth failed:", error);
                userId = 'Error';
            }
        } else {
            userId = user.uid;
        }
        document.getElementById('userIdDisplay').textContent = userId;
        isAuthReady = true;
        console.log("Firebase Auth Ready. User ID:", userId);
    });
} else {
    console.warn("Firebase config not found. Using anonymous session ID.");
    userId = crypto.randomUUID();
    document.getElementById('userIdDisplay').textContent = userId;
    isAuthReady = true;
}

// --- 2. API KEYS (IMPORTANT: INSERT YOUR ACTUAL KEYS HERE) ---
    const OPENWEATHER_API_KEY = `088d68b011e4f97d973e7d4f85198c4d`; // Get from openweathermap.org
    const GOOGLE_GEOCODING_API_KEY = `BkbtfFP7bbVuEHzlf50pnxJ4531wmxUSGtANGaKb`; // Get from Google Cloud Console

if (OPENWEATHER_API_KEY.includes('YOUR_')) {
    console.error("🚨 WARNING: OpenWeatherMap API key is missing/placeholder. Weather reports will fail.");
}
if (GOOGLE_GEOCODING_API_KEY.includes('YOUR_')) {
    console.warn("⚠️ WARNING: Google Geocoding API key is missing/placeholder. Location search will not work.");
}

// --- 3. MAP SETUP (Leaflet) ---
let map;
let marker;
let likelihoodChartInstance = null;
const defaultLat = 34.0522; // Los Angeles
const defaultLon = -118.2437;
let currentSelectedLocation = { lat: defaultLat, lon: defaultLon, name: 'Los Angeles, USA' };

window.onload = function () {
    // Initialize Map
    map = L.map('map').setView([defaultLat, defaultLon], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Add default marker
    marker = L.marker([defaultLat, defaultLon]).addTo(map)
        .bindPopup(`Analysis Location: ${currentSelectedLocation.name}`)
        .openPopup();
    updateCoordsDisplay(defaultLat, defaultLon);

    // Initialize Select2 for location search with Google Geocoding API
    $('#locationSearch').select2({
        placeholder: 'Search for a city...',
        minimumInputLength: 3,
        ajax: {
            transport: async function (params, success, failure) {
                if (GOOGLE_GEOCODING_API_KEY.includes('YOUR_')) {
                    console.error("Geocoding failed: API key not set.");
                    success({ results: [] });
                    return;
                }
                try {
                    const result = await forwardGeocodeGoogle(params.data.term);
                    if (result) {
                        success({
                            results: [{
                                id: `${result.lat},${result.lon}`,
                                text: result.displayName,
                                lat: result.lat,
                                lon: result.lon
                            }]
                        });
                    } else {
                        success({ results: [] }); // No results found
                    }
                } catch (error) {
                    failure(error);
                }
            },
            cache: true
        }
    });

    // Handle Select2 selection
    $('#locationSearch').on('select2:select', function (e) {
        const { lat, lon, text } = e.params.data;
        updateLocation(parseFloat(lat), parseFloat(lon), text);
    });

    // Handle map click
    map.on('click', async function (e) {
        const { lat, lng } = e.latlng;
        
        // Show loading indicator in Select2
        const tempName = `Fetching location name...`;
        const newOption = new Option(tempName, `${lat},${lng}`, true, true);
        $('#locationSearch').append(newOption).trigger('change');
        
        updateLocation(lat, lng, tempName); // Update map marker and coords display

        try {
            const placeName = await reverseGeocode(lat, lng);
            const finalName = placeName || `Lat: ${lat.toFixed(4)}, Lon: ${lng.toFixed(4)}`;
            
            // Remove the 'Fetching...' option and add the final one
            $('#locationSearch').empty().append(new Option(finalName, `${lat},${lng}`, true, true)).trigger('change');
            currentSelectedLocation.name = finalName;
            
            // Re-trigger the selection update
            $('#locationSearch').trigger({
                type: 'select2:select',
                params: {
                    data: { id: `${lat},${lng}`, text: finalName, lat: lat, lon: lng }
                }
            });
            
        } catch (error) {
            console.error("Reverse geocoding failed:", error);
            // Fallback to coordinates if API fails
            const fallbackName = `Lat: ${lat.toFixed(4)}, Lon: ${lng.toFixed(4)}`;
            $('#locationSearch').empty().append(new Option(fallbackName, `${lat},${lng}`, true, true)).trigger('change');
            currentSelectedLocation.name = fallbackName;
        }
    });

    // Initialize Flatpickr for date and time
    flatpickr("#dateTimePicker", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        defaultDate: new Date(),
        minuteIncrement: 30,
        minDate: "1980-01-01", 
        maxDate: new Date().fp_incr(14),
    });

    // Set up event listeners
    document.getElementById('analyzeButton').addEventListener('click', runAnalysis);
};

function updateLocation(lat, lon, name = null) {
    if (marker) {
        marker.setLatLng([lat, lon]);
        if (name) {
            marker.setPopupContent(`Analysis Location: ${name}`).openPopup();
        }
    }
    map.setView([lat, lon], 10);
    currentSelectedLocation = { lat: lat, lon: lon, name: name || currentSelectedLocation.name };
    updateCoordsDisplay(lat, lon);
}

function updateCoordsDisplay(lat, lon) {
    document.getElementById('latitude').value = lat.toFixed(4);
    document.getElementById('longitude').value = lon.toFixed(4);
    document.getElementById('coordsDisplay').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Forward Geocoding using Google Geocoding API.
 */
async function forwardGeocodeGoogle(query) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_GEOCODING_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            const lat = result.geometry.location.lat;
            const lon = result.geometry.location.lng;
            const displayName = result.formatted_address;
            return { lat, lon, displayName };
        }
        return null;
    } catch (error) {
        console.error("Error in Google forward geocoding:", error);
        return null;
    }
}

/**
 * Reverse Geocoding using Google Geocoding API.
 */
async function reverseGeocode(lat, lon) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${GOOGLE_GEOCODING_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === 'OK' && data.results.length > 0) {
            const placeName = data.results[0].formatted_address;
            currentSelectedLocation.name = placeName;
            return placeName;
        }
    } catch (error) {
        console.error("Error in Google reverse geocoding:", error);
    }
    currentSelectedLocation.name = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
    return currentSelectedLocation.name;
}

// --- 4. WEATHER & GEOCODING API LOGIC ---
const NASA_POWER_API_URL = "https://power.larc.nasa.gov/api/temporal/monthly/climatology/point?parameters=";
const OPENWEATHER_CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather?";
const OPENWEATHER_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast?"; 

// NASA parameters for Tmax, Tmin, Precipitation, Wind Speed, Relative Humidity
const NASA_PARAMETERS = "T2M_MAX,T2M_MIN,PRECTOT,WS10M,RH2M"; 

// Hardcoded Extreme Thresholds (Simplified based on the MERRA-2 variables)
const EXTREME_THRESHOLDS = {
    'Very Hot': { param: 'T2M_MAX', threshold: 32.0, units: 'C', description: 'Maximum temperature often above 32°C (90°F)' },
    'Very Cold': { param: 'T2M_MIN', threshold: 0.0, units: 'C', description: 'Minimum temperature often below 0°C (32°F)' },
    'Heavy Rain': { param: 'PRECTOT', threshold: 10.0, units: 'mm/day', description: 'Average daily precipitation above 10mm' },
    'Very Windy': { param: 'WS10M', threshold: 8.0, units: 'm/s', description: 'Average 10-meter wind speed above 8 m/s (~18 mph)' },
    'High Humidity': { param: 'RH2M', threshold: 75.0, units: '%', description: 'Average relative humidity above 75%' }
};

function getNasaPowerUrl(lat, lon) {
    return `${NASA_POWER_API_URL}${NASA_PARAMETERS}&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
}

function getOpenWeatherCurrentUrl(lat, lon) {
    return `${OPENWEATHER_CURRENT_URL}lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`; // Use metric
}

function getOpenWeatherForecastUrl(lat, lon) {
    return `${OPENWEATHER_FORECAST_URL}lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
}

async function fetchWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            return await response.json();
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} failed for ${url}: ${error.message}. Retrying in ${1000 * (2 ** i)}ms...`);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** i)));
            } else {
                throw new Error("Failed to fetch data after multiple retries. Check API keys and network connection.");
            }
        }
    }
}

async function runAnalysis() {
    const lat = parseFloat(document.getElementById('latitude').value);
    const lon = parseFloat(document.getElementById('longitude').value);
    const dateTimeInput = document.getElementById('dateTimePicker').value;
    const selectedDateTime = flatpickr.parseDate(dateTimeInput, "Y-m-d H:i");
    
    if (!selectedDateTime) {
        alert("Please select a valid date and time.");
        return;
    }

    const selectedMonthIndex = selectedDateTime.getMonth() + 1; // 1-indexed month
    const selectedMonthName = selectedDateTime.toLocaleString('en-US', { month: 'long' });
    
    const analyzeButton = document.getElementById('analyzeButton');
    const reportLoadingIndicator = document.getElementById('reportLoadingIndicator');
    const planningLoadingIndicator = document.getElementById('planningLoadingIndicator');
    const chartContainer = document.getElementById('chartContainer');
    const currentWeatherReport = document.getElementById('currentWeatherReport');
    const locationDetails = document.getElementById('locationDetails');
    const downloadButton = document.getElementById('downloadButton');
    const summaryText = document.getElementById('summaryText');
    const activityRecommendations = document.getElementById('activityRecommendations');
    const initialPrompt = document.getElementById('initialPrompt');

    analyzeButton.disabled = true;
    reportLoadingIndicator.classList.remove('hidden');
    planningLoadingIndicator.classList.remove('hidden');
    initialPrompt.classList.add('hidden');
    chartContainer.classList.add('hidden');
    currentWeatherReport.classList.add('hidden');
    locationDetails.classList.add('hidden');
    activityRecommendations.classList.add('hidden');
    downloadButton.disabled = true;
    summaryText.textContent = 'Gathering data and calculating insights...';

    let allData = {
        metadata: {
            appId: appId,
            userId: userId,
            timestamp: new Date().toISOString(),
            location: { latitude: lat, longitude: lon, name: currentSelectedLocation.name },
            selectedDateTime: selectedDateTime.toISOString()
        },
        nasaClimatology: null,
        currentWeather: null,
        weatherForecast: null,
        likelihoods: null,
        activityRecommendations: null
    };

    try {
        // 1. Fetch NASA POWER Climatology (Historical Likelihoods)
        const nasaPowerApiUrl = getNasaPowerUrl(lat, lon);
        const nasaData = await fetchWithRetry(nasaPowerApiUrl);
        allData.nasaClimatology = nasaData;
        const monthlyAverages = {};
        for (const key in nasaData.properties.parameter) {
            // Check if the month data exists before accessing
            if (nasaData.properties.parameter[key][selectedMonthIndex.toString()]) {
                monthlyAverages[key] = nasaData.properties.parameter[key][selectedMonthIndex.toString()];
            } else {
                 monthlyAverages[key] = 'N/A';
            }
        }
        const likelihoodResults = calculateLikelihoods(monthlyAverages, selectedMonthName);
        allData.likelihoods = likelihoodResults;
        updateChart(likelihoodResults);

        // 2. Fetch Current Weather & Forecast (Only if API key is set)
        let currentWeatherData = null;
        let forecastWeatherData = null;

        if (!OPENWEATHER_API_KEY.includes('YOUR_')) {
            const openWeatherCurrentApiUrl = getOpenWeatherCurrentUrl(lat, lon);
            currentWeatherData = await fetchWithRetry(openWeatherCurrentApiUrl);
            allData.currentWeather = currentWeatherData;
            displayCurrentWeather(currentWeatherData);
            displayLocationDetails(currentWeatherData, lat, lon);

            const openWeatherForecastApiUrl = getOpenWeatherForecastUrl(lat, lon);
            forecastWeatherData = await fetchWithRetry(openWeatherForecastApiUrl);
            allData.weatherForecast = forecastWeatherData;
        } else {
            // Placeholder data if API key is missing
            currentWeatherData = { name: currentSelectedLocation.name, main: { temp: NaN }, weather: [{ description: 'API Key Missing' }] };
            displayCurrentWeather(currentWeatherData);
            displayLocationDetails(currentWeatherData, lat, lon);
            console.error("OpenWeatherMap API key is missing. Displaying limited weather data.");
        }


        // 3. Generate Summary and Activity Recommendations
        const summary = generateSummary(likelihoodResults, lat, lon, selectedMonthName, currentWeatherData);
        summaryText.innerHTML = summary.text;
        const recommendations = generateActivityRecommendations(likelihoodResults, currentWeatherData, forecastWeatherData);
        allData.activityRecommendations = recommendations;
        displayActivityRecommendations(recommendations);
        activityRecommendations.classList.remove('hidden');

        // 4. Prepare and enable download
        setupDownload(allData);

    } catch (error) {
        console.error("Analysis Failed:", error);
        summaryText.innerHTML = `<span class="text-red-600">Error: Could not retrieve complete data (${error.message}). Please ensure your API keys are correct and try again.</span>`;
    } finally {
        analyzeButton.disabled = false;
        reportLoadingIndicator.classList.add('hidden');
        planningLoadingIndicator.classList.add('hidden');
        chartContainer.classList.remove('hidden');
    }
}

// --- 5. DATA ANALYSIS & DISPLAY FUNCTIONS (COMPLETED STUBS) ---
function calculateLikelihoods(monthlyAverages, selectedMonthName) {
    const likelihoods = {};
    for (const [key, { param, threshold, units, description }] of Object.entries(EXTREME_THRESHOLDS)) {
        const average = monthlyAverages[param];
        let score = 0; // 0 to 100
        let status = 'Unknown';
        
        if (typeof average === 'number') {
            const isHighRisk = (key.includes('Hot') || key.includes('Rain') || key.includes('Windy') || key.includes('Humidity')) 
                ? (average > threshold) : (average < threshold);
            
            if (isHighRisk) {
                // Simplified scoring: the further it is from the threshold, the higher the score
                const difference = Math.abs(average - threshold);
                score = Math.min(100, 50 + difference * 10); // Base 50, scale up by 10 for difference
                status = 'High Likelihood';
            } else {
                score = Math.max(0, 50 - Math.abs(average - threshold) * 5); // Base 50, scale down
                status = 'Low Likelihood';
            }
        } else {
            status = 'Data N/A';
        }

        likelihoods[key] = {
            param: param,
            average: typeof average === 'number' ? average.toFixed(2) : average,
            threshold: threshold,
            units: units,
            description: description,
            score: Math.round(score),
            status: status
        };
    }
    return likelihoods;
}

function updateChart(likelihoodResults) {
    const labels = Object.keys(likelihoodResults);
    const data = labels.map(key => likelihoodResults[key].score);
    const backgroundColors = data.map(score => score > 70 ? 'rgba(239, 68, 68, 0.7)' : (score > 40 ? 'rgba(251, 191, 36, 0.7)' : 'rgba(59, 130, 246, 0.7)'));
    const borderColors = data.map(score => score > 70 ? 'rgb(239, 68, 68)' : (score > 40 ? 'rgb(251, 191, 36)' : 'rgb(59, 130, 246)'));

    const ctx = document.getElementById('likelihoodChart').getContext('2d');
    
    if (likelihoodChartInstance) {
        likelihoodChartInstance.destroy();
    }

    likelihoodChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Historical Likelihood Score (0-100)',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Likelihood Score' }
                }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: `Historical Extreme Likelihoods (Based on NASA MERRA-2 Climatology)` }
            }
        }
    });
}

function displayCurrentWeather(currentWeatherData) {
    if (currentWeatherData && currentWeatherData.main) {
        document.getElementById('currentTemp').textContent = `${Math.round(currentWeatherData.main.temp)}°C`;
        document.getElementById('currentConditions').textContent = currentWeatherData.weather[0].description.toUpperCase();
        document.getElementById('currentWind').textContent = `${(currentWeatherData.wind.speed * 3.6).toFixed(1)} km/h`; // m/s to km/h
        document.getElementById('currentHumidity').textContent = `${currentWeatherData.main.humidity}%`;
        document.getElementById('currentWeatherSource').textContent = 'OpenWeatherMap';
    } else {
        document.getElementById('currentTemp').textContent = `N/A`;
        document.getElementById('currentConditions').textContent = `Data Unavailable (Check API Key)`;
        document.getElementById('currentWind').textContent = `N/A`;
        document.getElementById('currentHumidity').textContent = `N/A`;
        document.getElementById('currentWeatherSource').textContent = 'No Data';
    }
    document.getElementById('currentWeatherReport').classList.remove('hidden');
}

function displayLocationDetails(currentWeatherData, lat, lon) {
    document.getElementById('reportLocationName').textContent = currentSelectedLocation.name || currentWeatherData.name || 'N/A';
    // OpenWeather provides a timezone offset in seconds
    const tzOffset = currentWeatherData.timezone;
    const tzHours = tzOffset / 3600;
    const tzSign = tzHours >= 0 ? '+' : '';
    document.getElementById('reportTimezone').textContent = `UTC${tzSign}${tzHours}`;
    
    // OpenWeatherMap does not provide elevation directly, use a placeholder
    document.getElementById('reportElevation').textContent = 'N/A (Use a dedicated Elevation API for accuracy)'; 
    locationDetails.classList.remove('hidden');
}

function generateSummary(likelihoodResults, lat, lon, selectedMonthName, currentWeatherData) {
    const highRisks = Object.entries(likelihoodResults)
        .filter(([, data]) => data.score > 70)
        .map(([key]) => key);

    let summaryText = `The analysis for **${currentSelectedLocation.name}** in **${selectedMonthName}** (climatology) is complete. `;
    
    if (currentWeatherData && currentWeatherData.main) {
        summaryText += `Current conditions are **${currentWeatherData.weather[0].description.toUpperCase()}** with a temperature of **${Math.round(currentWeatherData.main.temp)}°C**. `;
    }

    if (highRisks.length === 0) {
        summaryText += `Historically, this time of year presents a **low likelihood** of extreme weather conditions based on NASA MERRA-2 data. Planning is advised to proceed with minor caution.`;
    } else {
        summaryText += `**Caution is advised:** Historically, the month of ${selectedMonthName} shows a **high likelihood** for: **${highRisks.join(', ')}**. Plan accordingly for these conditions.`;
    }

    return { text: summaryText };
}

function generateActivityRecommendations(likelihoodResults, currentWeatherData, forecastWeatherData) {
    const recommendations = [];
    const highWind = likelihoodResults['Very Windy'].score > 70;
    const highHeat = likelihoodResults['Very Hot'].score > 70;
    const highRain = likelihoodResults['Heavy Rain'].score > 70;
    const currentTemp = currentWeatherData?.main?.temp;
    const currentConditions = currentWeatherData?.weather?.[0]?.main.toLowerCase() || 'clear';

    // 1. General Planning
    if (highWind) {
        recommendations.push({ status: 'Warning', text: 'Secure all loose items. Avoid high-altitude activities like drone operations or high ropes.' });
    }
    if (highHeat) {
        recommendations.push({ status: 'Warning', text: 'Schedule outdoor work/activities for early morning or late evening. Ensure adequate hydration.' });
    }
    if (highRain) {
        recommendations.push({ status: 'Caution', text: 'Plan for potential travel delays and have indoor backup options for any scheduled outdoor events.' });
    }

    // 2. Outdoor Activities (Hiking/Camping)
    if (highHeat && currentTemp > 28) {
        recommendations.push({ status: 'Warning', text: 'Hiking/Camping: High heat warning. Stick to shaded trails and carry extra water (3L+).' });
    } else if (currentConditions.includes('rain') || highRain) {
        recommendations.push({ status: 'Caution', text: 'Hiking/Camping: Ground may be wet and slippery. Pack waterproof gear and check for flash flood risks.' });
    } else {
         recommendations.push({ status: 'Success', text: 'Hiking/Camping: Conditions generally favorable, but check specific ground conditions.' });
    }

    // 3. Astronomy/Earth Observation
    if (currentConditions.includes('cloud') || highRain) {
        recommendations.push({ status: 'Warning', text: 'Earth Observation/Astronomy: Cloud cover or precipitation is likely, which will severely impact visibility. Consider postponing.' });
    } else {
         recommendations.push({ status: 'Success', text: 'Earth Observation/Astronomy: Good visibility expected. Check for localized atmospheric haze before setting up sensitive equipment.' });
    }
    
    if (recommendations.length === 0) {
        recommendations.push({ status: 'Success', text: 'Excellent conditions are historically typical for this time of year. Proceed with confidence!' });
    }

    return recommendations;
}

function displayActivityRecommendations(recommendations) {
    const ul = document.getElementById('activityList');
    ul.innerHTML = '';
    
    recommendations.forEach(rec => {
        const li = document.createElement('li');
        let icon = '';
        let color = 'text-gray-600';

        switch(rec.status) {
            case 'Warning':
                icon = '⚠️';
                color = 'text-red-600 font-semibold';
                break;
            case 'Caution':
                icon = '🔶';
                color = 'text-yellow-600';
                break;
            case 'Success':
                icon = '✅';
                color = 'text-green-600';
                break;
            default:
                icon = '•';
        }

        li.innerHTML = `<span class="${color}">${icon} ${rec.text}</span>`;
        ul.appendChild(li);
    });
}

function setupDownload(allData) { 
    document.getElementById('downloadButton').disabled = false;
    document.getElementById('downloadButton').onclick = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `weather_analysis_${Date.now()}.json`);
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        document.body.removeChild(dlAnchorElem);
    };
}