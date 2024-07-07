let notificationId = 0; // Variable global para el ID de notificación

let KeysWeatherbit = [
  { key: CONFIG.WEATHERBIT_API_URL_UV_API_KEY_PRIMARY, callsRemaining: 0, resetTimestamp: 0 },
  { key: CONFIG.WEATHERBIT_API_URL_UV_API_KEY_SECUNDARY, callsRemaining: 0, resetTimestamp: 0 },
  { key: CONFIG.WEATHERBIT_API_URL_UV_API_KEY_TERCIARY, callsRemaining: 0, resetTimestamp: 0 },
];

async function updateWeather() {
  const lat = "-5.2";
  const lon = "-80.6333";
  const maxRetries = 3;
  const retryDelay = 2000;

  // Función para obtener el estado de uso de una clave API
  async function getApiUsage(key) {
    const url = `${CONFIG.WEATHERBIT_API_URL_USAGE}${key}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching API usage: ${response.statusText}`);
    }
    return await response.json();
  }

  async function updateKeysUsage() {
    for (let i = 0; i < KeysWeatherbit.length; i++) {
      const usage = await getApiUsage(KeysWeatherbit[i].key);
      KeysWeatherbit[i].callsRemaining = usage.calls_remaining;
      KeysWeatherbit[i].resetTimestamp = usage.calls_reset_ts * 1000; // Convertir a milisegundos
    }
  }

  async function fetchWithRetry(url, options, retries) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`API response error: ${url} - ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        console.warn(`Retrying... (${i + 1}/${retries})`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  async function fetchWeatherWithKeys(lat, lon) {
    await updateKeysUsage(); // Actualizar el estado de uso de las claves
    const now = Date.now();
    for (let i = 0; i < KeysWeatherbit.length; i++) {
      const keyInfo = KeysWeatherbit[i];
      if (keyInfo.callsRemaining > 0 || now > keyInfo.resetTimestamp) {
        try {
          const url = `${CONFIG.WEATHERBIT_API_URL}?lat=${lat}&lon=${lon}&key=${keyInfo.key}&include=minutely`;
          const weatherbit = await fetchWithRetry(url, {}, maxRetries);
          keyInfo.callsRemaining--; // Decrementar el contador de llamadas restantes
          // Rotar la clave utilizada al inicio del array
          const usedKey = KeysWeatherbit.splice(i, 1)[0];
          KeysWeatherbit.unshift(usedKey);
          return weatherbit.data[0];
        } catch (error) {
          if (
            error.message.includes("API response error") &&
            error.message.includes("429")
          ) {
            keyInfo.callsRemaining = 0; // Marcar la clave como agotada
            keyInfo.resetTimestamp = Date.now() + 24 * 60 * 60 * 1000; // Bloquearla por 24 horas
            // Si la clave alcanza su límite, continuar con la siguiente
            if (i === KeysWeatherbit.length - 1) {
              showNotification("Todas las claves API han llegado a su límite.");
              throw new Error("Todas las claves API han llegado a su límite.");
            }
          } else {
            throw error;
          }
        }
      }
    }
  }

  function showNotification(message) {
    notificationId++; // Incrementar el ID de la notificación
    cordova.plugins.notification.local.schedule({
      id: notificationId, // Asignar un ID único
      title: "ApiKey Límite",
      text: message,
      foreground: true,
      smallIcon: 'res://drawable/smallicon', //24x24
      icon: 'file://img/api.png',  // Ruta del icono
    });
  }

  try {
    const weather = await fetchWithRetry(
      `${CONFIG.WEATHER_API_URL}?lat=${lat}&lon=${lon}&appid=${CONFIG.API_KEY}&units=metric`,
      {},
      maxRetries
    );

    const weatherbitData = await fetchWeatherWithKeys(lat, lon);
    const temp = Math.floor(weatherbitData.temp);
    const description = translateWeatherDescription(
      weather.weather[0].description
    );
    const icon = weather.weather[0].icon;
    const feels_like = Math.floor(weatherbitData.app_temp);
    const pressure = Math.floor(weatherbitData.pres);
    const humidity = Math.floor(weatherbitData.rh);
    const speed = Math.round((weatherbitData.wind_spd * 3.6).toFixed(1));
    const beaufort = getBeaufortScale(speed);
    const uvIndexImage = Math.floor(weatherbitData.uv);
    const uvScale = getUVScale(weatherbitData.uv);
    const pressureCategory = getPressureCategory(pressure);

    const weatherElement = document.getElementById("weather");
    weatherElement.innerHTML = `
      <div id="temperature">
        <img src="icons/climate/${icon}.svg" alt="${description}"></img>
        <div id="valor">${temp}°C</div>
      </div>
      <div id="description">${description}</div>
    `;

    const weatheroptions = document.getElementById("weather-options");
    weatheroptions.innerHTML = `
      <div class="weather-detail">
        <img src="icons/radiation/UV${uvIndexImage}.svg" alt="Sensación térmica">
        <span>Sensacion: ${feels_like}°C</span>
    
        <img src="icons/pressure/${pressureCategory.icon}" alt="Presión">
        <span>Presion: ${pressure}mbar</span>
    
        <img src="icons/humidity/humidity.svg" alt="Humedad">
        <span>Humedad: ${humidity}%</span>
    
        <img src="icons/wind/${beaufort.scale}.svg" alt="Velocidad del viento">
        <span>Vel. Viento: ${speed}km/h</span>
      </div>
      <div class="weather-detail" style="visibility: hidden; display: none">
        <img src="icons/radiation/UV${uvIndexImage}.svg" alt="${uvScale.scale}">
        <span>Índice UV:(${uvScale.scale})</span>
      </div>
    `;
  } catch (error) {
    console.error("Error fetching weather:", error);
    document.getElementById("weather").innerText =
      "Error fetching weather data.";
  }
}

function getPressureCategory(pressure) {
  if (pressure >= 1020)
    return {
      category: "Alta presión",
      icon: "high_pressure.svg",
      description: "Buen tiempo, cielos despejados, temperaturas moderadas.",
    };
  if (pressure < 1000)
    return {
      category: "Baja presión",
      icon: "low_pressure.svg",
      description: "Lluvias, nubes, tormentas, condiciones inestables.",
    };
  return {
    category: "Presión normal",
    icon: "normal_pressure.svg",
    description: "Condiciones climáticas típicas, ni alta ni baja presión.",
  };
}

function getUVScale(uvIndex) {
  if (uvIndex <= 2)
    return {
      scale: "Bajo",
      recommendations: "Riesgo mínimo de daño por la exposición al sol.",
      icon: "uv_low.svg",
    };
  if (uvIndex <= 5)
    return {
      scale: "Moderado",
      recommendations:
        "Utiliza protección solar si vas a estar al aire libre por un tiempo prolongado.",
      icon: "uv_moderate.svg",
    };
  if (uvIndex <= 7)
    return {
      scale: "Alto",
      recommendations:
        "Usa protección solar, busca sombra durante las horas pico de sol (10 a.m. a 4 p.m.).",
      icon: "uv_high.svg",
    };
  if (uvIndex <= 10)
    return {
      scale: "Muy alto",
      recommendations:
        "Usa protección solar extra, evita el sol durante las horas pico.",
      icon: "uv_very_high.svg",
    };
  return {
    scale: "Extremo",
    recommendations:
      "Toma todas las precauciones posibles, evita salir al sol durante las horas pico.",
    icon: "uv_extreme.svg",
  };
}

function translateWeatherDescription(description) {
  const translations = {
    "clear sky": "Cielo despejado",
    "few clouds": "Pocas nubes",
    "scattered clouds": "Nubes dispersas",
    "broken clouds": "Nubes rotas",
    "shower rain": "Lluvia de ducha",
    rain: "Lluvia",
    thunderstorm: "Tormenta",
    snow: "Nieve",
    mist: "Neblina",
    "overcast clouds": "Nublado",
  };
  return translations[description] || description;
}

function getBeaufortScale(speed) {
  if (speed < 1) return { scale: 0, description: "Calma", icon: "calm.svg" };
  if (speed <= 5)
    return { scale: 1, description: "Ventolina", icon: "ventolina.svg" };
  if (speed <= 11)
    return {
      scale: 2,
      description: "Brisa muy ligera",
      icon: "brisa_muy_ligera.svg",
    };
  if (speed <= 19)
    return { scale: 3, description: "Brisa ligera", icon: "brisa_ligera.svg" };
  if (speed <= 28)
    return {
      scale: 4,
      description: "Brisa moderada",
      icon: "brisa_moderada.svg",
    };
  if (speed <= 38)
    return { scale: 5, description: "Brisa fresca", icon: "brisa_fresca.svg" };
  if (speed <= 49)
    return { scale: 6, description: "Brisa fuerte", icon: "brisa_fuerte.svg" };
  if (speed <= 61)
    return {
      scale: 7,
      description: "Viento moderado",
      icon: "viento_moderado.svg",
    };
  if (speed <= 74)
    return {
      scale: 8,
      description: "Viento fresco",
      icon: "viento_fresco.svg",
    };
  if (speed <= 88)
    return {
      scale: 9,
      description: "Viento fuerte",
      icon: "viento_fuerte.svg",
    };
  if (speed <= 102)
    return { scale: 10, description: "Temporal", icon: "temporal.svg" };
  if (speed <= 117)
    return {
      scale: 11,
      description: "Temporal fuerte",
      icon: "temporal_fuerte.svg",
    };
  return { scale: 12, description: "Huracán", icon: "huracan.svg" };
}

async function updateTime() {
  const now = new Date();
  const time = formatTime(now);
  const date = formatDate(now);
  const hours = now.getHours();
  const period = getPeriod(hours);

  document.getElementById("time").innerText = time;
  document.getElementById("date").innerText = date;
  changeBackground(period);
}

function getPeriod(hours) {
  if (hours >= 5 && hours < 7) return "dawn";
  if (hours >= 7 && hours < 16) return "day";
  if (hours >= 16 && hours < 18) return "afternoon";
  return "night";
}

function changeBackground(period) {
  const body = document.body;
  switch (period) {
    case "dawn":
      body.style.backgroundImage = "url('img/period/amanecer.jpg')";
      body.style.color = "black";
      body.style.textShadow = `
                -1px -1px 0 #fff,  
                1px -1px 0 #fff,
                -1px  1px 0 #fff,
                1px  1px 0 #fff
            `;
      break;
    case "day":
      body.style.backgroundImage = "url('img/period/dia.jpg')";
      body.style.color = "black";
      body.style.textShadow = `
                -1px -1px 0 #fff,  
                1px -1px 0 #fff,
                -1px  1px 0 #fff,
                1px  1px 0 #fff
            `;
      break;
    case "afternoon":
      body.style.backgroundImage = "url('img/period/tarde.jpg')";
      body.style.color = "black";
      body.style.textShadow = `
                -1px -1px 0 #fff,  
                1px -1px 0 #fff,
                -1px  1px 0 #fff,
                1px  1px 0 #fff
            `;
      break;
    case "night":
      body.style.backgroundImage = "url('img/period/noche.jpg')";
      body.style.color = "white";
      body.style.textShadow = `
                -1px -1px 0 #000,  
                1px -1px 0 #000,
                -1px  1px 0 #000,
                1px  1px 0 #000
            `;
      break;
  }
}

function formatTime(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // El formato de 12 horas no tiene un "0" hora
  hours = hours.toString().padStart(2, "0"); // Añade cero inicial
  return `${hours}:${minutes} ${ampm}`;
}

function formatDate(date) {
  const day = date.getDate().toString().padStart(2, "0");
  const monthNames = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} de ${month} del ${year}`;
}

async function updateCalendar() {
  document.getElementById("calendar").innerHTML = `
    <img src="icons/social/outlook.svg" alt="Outlook Logo" class="clickable-image" ">
  `;
}

async function updateOutlook() {
  document.getElementById("outlook").innerText = "Reuniones del día...";
}

document.addEventListener("deviceready", function () {
    if (window.plugins && window.plugins.insomnia) {
      window.plugins.insomnia.keepAwake(
        function () {
          console.log("Pantalla mantendrá encendida.");
        },
        function () {
          console.error("Error al intentar mantener la pantalla encendida.");
        }
      );
    }

    if (window.screen && window.screen.orientation) {
      window.screen.orientation
        .lock("landscape")
        .then(function () {
          console.log("Orientación bloqueada en horizontal.");
        })
        .catch(function (error) {
          console.error("Error al intentar bloquear la orientación: ", error);
        });
    }
  },
  false
);

setInterval(updateTime, 1000);
setInterval(updateWeather, 900000); // Cada hora
updateWeather();
updateCalendar();
updateOutlook();
