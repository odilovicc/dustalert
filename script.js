'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { city: 'Ташкент', country: 'Узбекистан', lat: 41.3111, lon: 69.2797, map: null, reportMap: null, point: null, reports: [], events: [], generation: 0, lastAlert: '', air: null, reportsLayer: null, chosenMarker: null, photo: null, current: null, airRows: [], airPoints: [], sensitive: false };
const storage = {
 read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
 write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Не удалось сохранить: хранилище недоступно или заполнено.'); return false; } }
};
state.reports = storage.read('dustalert-reports', []);
state.events = storage.read('dustalert-events', []);
if (!Array.isArray(state.reports)) state.reports = [];
if (!Array.isArray(state.events)) state.events = [];
let toastTimer, airController, searchController;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function getJSON(url, signal) { const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000) }); if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); }
function classification(aqi) {
 if (!Number.isFinite(aqi) || aqi < 0) return { label: 'Нет данных', color: '#a1aca0', description: 'Данные сейчас недоступны. Попробуйте обновить позже.' };
 if (aqi <= 50) return { label: 'Хорошее', color: '#43a75f', description: 'Хороший день, чтобы побыть на свежем воздухе.' };
 if (aqi <= 100) return { label: 'Умеренное', color: '#edc441', description: 'Если вы чувствительны к загрязнению, следите за самочувствием.' };
 if (aqi <= 150) return { label: 'Плохое', color: '#f28b38', description: 'Чувствительным людям стоит сократить нагрузку на улице.' };
 return { label: aqi > 300 ? 'Опасное' : 'Очень плохое', color: '#e05252', description: 'Сократите длительное пребывание и интенсивную нагрузку на улице.' };
}
function dustIndex(current) {
 const indices = [current?.us_aqi_pm2_5, current?.us_aqi_pm10].filter(value => Number.isFinite(value) && value >= 0);
 return indices.length ? Math.max(...indices) : null;
}
function activityAdvice(aqi, sensitive = false) {
 const definitions = [
  { key: 'walk', title: 'Прогулка', icon: 'walk' },
  { key: 'bike', title: 'Велосипед', icon: 'bike' },
  { key: 'picnic', title: 'Пикник', icon: 'picnic' },
  { key: 'exercise', title: 'Тренировка', icon: 'exercise' }
 ];
 let tone, summary, health, statuses, descriptions;
 if (!Number.isFinite(aqi) || aqi < 0) {
  tone = 'unknown'; summary = 'Недостаточно данных для рекомендации.';
  health = 'Обновите прогноз перед выходом на улицу.';
  statuses = Array(4).fill('Нет данных');
  descriptions = Array(4).fill('Сейчас оценить условия по качеству воздуха не удалось.');
 } else if (aqi <= 50) {
  tone = 'good'; summary = 'Воздух благоприятен для отдыха на улице.';
  statuses = ['Можно гулять', 'Можно кататься', 'Можно планировать', 'Можно заниматься'];
  descriptions = ['Подойдёт прогулка в привычном темпе.', 'Выбирайте комфортный маршрут и нагрузку.', 'По качеству воздуха условия благоприятные.', 'Подойдёт ваша обычная физическая активность.'];
  health = sensitive ? 'Учитывайте свои ограничения и рекомендации врача даже при хорошем воздухе.' : 'Выбирайте привычную нагрузку и следите за самочувствием.';
 } else if (aqi <= 100) {
  tone = 'caution'; summary = sensitive ? 'Планируйте спокойный отдых и следите за самочувствием.' : 'Можно планировать отдых с учётом самочувствия.';
  statuses = sensitive ? ['В спокойном темпе', 'Без интенсивной езды', 'Следите за самочувствием', 'Снизьте нагрузку'] : ['Можно гулять', 'Можно кататься', 'Можно планировать', 'С учётом самочувствия'];
  descriptions = sensitive ? ['При дискомфорте сократите прогулку.', 'Если загрязнение влияет на вас, перенесите долгую или интенсивную поездку.', 'При дискомфорте завершите отдых раньше.', 'Если вы особенно чувствительны, выберите менее интенсивное занятие.'] : ['Для большинства людей воздух приемлем.', 'Ориентируйтесь на привычную нагрузку.', 'Перед выходом ещё раз проверьте прогноз.', 'При дискомфорте сделайте перерыв.'];
  health = 'Если вы особенно чувствительны к загрязнению, уменьшите длительную или интенсивную нагрузку при появлении симптомов.';
 } else if (aqi <= 150) {
  tone = 'limit'; summary = sensitive ? 'Выбирайте короткие и спокойные занятия.' : 'Отдых возможен, но чувствительным людям нужна осторожность.';
  statuses = sensitive ? ['Короткая прогулка', 'Коротко и спокойно', 'Лучше ненадолго', 'Меньше интенсивности'] : ['Следите за самочувствием', 'Без перегрузки', 'С осторожностью', 'Следите за нагрузкой'];
  descriptions = sensitive ? ['Сократите время и чаще отдыхайте.', 'Уменьшите длительность поездки и делайте паузы.', 'Сократите пребывание на улице.', 'Выберите щадящий режим и больше перерывов.'] : ['При кашле или одышке завершите прогулку.', 'При симптомах уменьшите темп или остановитесь.', 'Проверьте, подходят ли условия всем участникам.', 'Если чувствуете ухудшение, уменьшите нагрузку.'];
  health = 'Детям, пожилым людям и людям с заболеваниями сердца или лёгких стоит сократить время и интенсивность занятий на улице.';
 } else if (aqi <= 200) {
  tone = 'avoid'; summary = 'Сократите время на улице и физическую нагрузку.';
  statuses = ['Только ненадолго', 'Лучше перенести', 'Лучше перенести', 'Лучше в помещении'];
  descriptions = ['Выбирайте спокойный темп и больше перерывов.', 'Избегайте долгой или интенсивной поездки.', 'Длительное пребывание на улице лучше отложить.', 'Выберите место с более чистым воздухом.'];
  health = sensitive ? 'Избегайте длительных и интенсивных занятий на улице. Лучше перенесите их или выберите помещение с более чистым воздухом.' : 'Всем стоит снизить длительность и интенсивность занятий. Чувствительным людям лучше перенести нагрузку в помещение.';
 } else if (aqi <= 300) {
  tone = 'avoid'; summary = 'Лучше перенести отдых туда, где воздух чище.';
  statuses = ['Лучше отложить', 'Отложите поездку', 'Перенесите пикник', 'В помещении'];
  descriptions = ['Избегайте долгих прогулок и нагрузки.', 'Откажитесь от длительной и интенсивной езды.', 'Планируйте отдых после улучшения воздуха.', 'Выберите помещение с более чистым воздухом.'];
  health = sensitive ? 'Избегайте любой физической активности на улице. Отдыхайте в месте с более чистым воздухом.' : 'Избегайте длительных и интенсивных занятий на улице. Чувствительным людям нужно исключить уличную физическую нагрузку.';
 } else {
  tone = 'avoid'; summary = 'Опасный воздух: отложите занятия на улице.';
  statuses = ['Отложите прогулку', 'Не катайтесь на улице', 'Отложите пикник', 'Без уличной нагрузки'];
  descriptions = ['Останьтесь в месте с более чистым воздухом.', 'Вернитесь к поездкам после улучшения воздуха.', 'Перенесите отдых на другой день.', 'Избегайте любой физической нагрузки на улице.'];
  health = 'Всем следует избегать физической активности на улице. Чувствительным людям — оставаться в помещении с более чистым воздухом и снизить активность.';
 }
 return { tone, summary, health, activities: definitions.map((activity, i) => ({ ...activity, status: statuses[i], description: descriptions[i] })) };
}
function activityPopup(current) {
 const advice = activityAdvice(current?.us_aqi, state.sensitive);
 return '<div class="activity-popup"><b>Планы на улице</b><ul>' + advice.activities.map(activity => '<li>' + escapeHTML(activity.title) + ': <strong>' + escapeHTML(activity.status) + '</strong></li>').join('') + '</ul><p>' + escapeHTML(advice.health) + '</p></div>';
}
function renderActivities(loading = false) {
 const advice = activityAdvice(state.current?.us_aqi, state.sensitive);
 $('#activity-place').textContent = state.city;
 $('#activity-summary').textContent = loading ? 'Обновляем рекомендации…' : advice.summary;
 $('#activities').dataset.tone = advice.tone;
 $('#activity-cards').innerHTML = advice.activities.map(activity => '<article class="activity-card"><span class="activity-icon"><svg aria-hidden="true"><use href="#' + activity.icon + '"/></svg></span><h3>' + activity.title + '</h3><strong class="activity-status">' + (loading ? 'Ждём прогноз' : activity.status) + '</strong><p>' + (loading ? 'Проверяем качество воздуха.' : activity.description) + '</p></article>').join('');
 $('#activity-health').textContent = loading ? 'Рекомендации появятся после загрузки данных.' : advice.health + (advice.tone !== 'unknown' ? ' При кашле, одышке или необычной слабости прекратите нагрузку; при ухудшении самочувствия обратитесь за медицинской помощью.' : '');
}
function renderAirPoints(rows, points) {
 if (!state.air) return;
 rows.forEach((row, i) => {
  const aqi = dustIndex(row.current);
  if (aqi === null || !points[i]) return;
  const category = classification(aqi);
  const popup = document.createElement('div');
  popup.innerHTML = '<b>' + (i ? 'Точка прогноза' : escapeHTML(state.city)) + '</b><br>Индекс частиц: ' + Math.round(aqi) + ' · ' + category.label + '<br>PM2.5: ' + displayNumber(row.current.pm2_5) + ' мкг/м³<br>PM10: ' + displayNumber(row.current.pm10) + ' мкг/м³' + activityPopup(row.current) + '<small>Модельный прогноз CAMS / Open-Meteo. Рекомендации по общему US AQI; погоду проверьте отдельно.</small>';
  L.circleMarker(points[i], { radius: 48, color: category.color, weight: 2, opacity: .65, fillColor: category.color, fillOpacity: .23 }).addTo(state.air).bindPopup(popup.cloneNode(true));
  L.marker(points[i], { title: category.label + ' · индекс частиц ' + Math.round(aqi), icon: L.divIcon({ className: 'aq-marker', html: '<span style="background:' + category.color + '">' + Math.round(aqi) + '</span>', iconSize: [42,42], iconAnchor: [21,21] }) }).addTo(state.air).bindPopup(popup);
 });
}
function displayNumber(value) { return Number.isFinite(value) && value >= 0 ? value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—'; }
function resetAir() {
 state.current = null; state.airRows = []; state.airPoints = []; renderActivities(true);
 $('#aqi').textContent = '—'; $('#pm25').textContent = '—'; $('#pm10').textContent = '—'; $('#quality-label').textContent = 'Загружаем данные'; $('#quality-description').textContent = 'Проверяем качество воздуха в выбранном городе.';
 $('#updated').textContent = 'Ожидание ответа API'; $('#scale-pointer').hidden = true; $('#pm25-bar').style.width = '0'; $('#pm10-bar').style.width = '0';
 state.air?.clearLayers(); $('#alert-title').textContent = 'Проверяйте воздух перед прогулкой'; $('#alert-text').textContent = 'Загружаем прогноз для выбранного места.';
}
function renderCurrent(current) {
 state.current = current ?? null; renderActivities();
 const aqi = current?.us_aqi, category = classification(aqi);
 $('#aqi').textContent = Number.isFinite(aqi) ? Math.round(aqi) : '—'; $('#quality-label').textContent = category.label; $('#quality-description').textContent = category.description;
 $('.aqi-circle').style.borderColor = category.color; $('.aqi-circle').style.borderBottomColor = '#587e61'; $('#aqi').style.color = category.color;
 $('#pm25').textContent = displayNumber(current?.pm2_5); $('#pm10').textContent = displayNumber(current?.pm10);
 $('#pm25-bar').style.width = Number.isFinite(current?.pm2_5) ? Math.min(current.pm2_5 / 75 * 100, 100) + '%' : '0'; $('#pm10-bar').style.width = Number.isFinite(current?.pm10) ? Math.min(current.pm10 / 150 * 100, 100) + '%' : '0';
 $('#scale-pointer').hidden = !Number.isFinite(aqi); $('#scale-pointer').style.left = Math.min(aqi / 200 * 100, 99) + '%';
 const timestamp = current?.time ? new Date(current.time * 1000) : null;
 $('#updated').textContent = timestamp ? 'Прогноз на ' + timestamp.toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}) + ' UTC · получен ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : 'Данные недоступны';
 if (Number.isFinite(aqi) && aqi > 100) {
  const dusty = [current.us_aqi_pm2_5, current.us_aqi_pm10].some(x => Number.isFinite(x) && x > 100);
  $('#alert-title').textContent = dusty ? 'Внимание! Сегодня в вашем районе высокий уровень запылённости' : 'Внимание! Прогнозируется высокий уровень загрязнения воздуха';
  $('#alert-text').textContent = 'По прогнозу CAMS. Сократите длительные прогулки, закройте окна при пыли, если в помещении не жарко. Подробнее — в советах о здоровье.';
  const key = [state.city, current.time, category.label].join(':');
  if (storage.read('dustalert-notifications',false) && 'Notification' in window && Notification.permission === 'granted' && state.lastAlert !== key) {
   try { new Notification('DustAlert · ' + state.city, {body: $('#alert-title').textContent, tag:'dustalert-air'}); state.lastAlert = key; } catch { toast('Системное уведомление недоступно. Предупреждение показано на странице.'); }
  }
 } else { $('#alert-title').textContent = Number.isFinite(aqi) ? 'Предупреждения о воздухе' : 'Нет актуального прогноза'; $('#alert-text').textContent = Number.isFinite(aqi) ? 'Включите уведомления об ухудшении воздуха.' : 'Попробуйте обновить данные позже.'; }
}
async function loadAir() {
 const generation = ++state.generation; airController?.abort(); airController = new AbortController(); resetAir(); $('#refresh').disabled = true;
 const points = [[state.lat,state.lon],[state.lat+.065,state.lon-.085],[state.lat+.055,state.lon+.085],[state.lat-.065,state.lon-.065],[state.lat-.06,state.lon+.075]];
 const params = new URLSearchParams({latitude:points.map(p=>p[0].toFixed(4)).join(','),longitude:points.map(p=>p[1].toFixed(4)).join(','),current:'us_aqi,pm2_5,pm10,us_aqi_pm2_5,us_aqi_pm10',timeformat:'unixtime'});
 try {
  const payload = await getJSON('https://air-quality-api.open-meteo.com/v1/air-quality?' + params, airController.signal);
  if (generation !== state.generation) return;
  const rows = Array.isArray(payload) ? payload : [payload]; if (!rows[0]?.current) throw new Error('Missing current');
  renderCurrent(rows[0].current);
  state.airRows = rows; state.airPoints = points;
  renderAirPoints(rows, points);
 } catch (error) { if (generation !== state.generation) return; renderCurrent(null); $('#updated').textContent = 'Не удалось связаться с API'; toast('Данные о воздухе недоступны. Проверьте подключение и нажмите ↻.'); }
 finally { if (generation === state.generation) $('#refresh').disabled = false; }
}
function addTiles(map) { const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map); let warned=false; tiles.on('tileerror',()=>{if(!warned){warned=true;toast('Часть карты не загрузилась. Проверьте подключение к интернету.');}}); }
function createInteractiveMap(id) {
 return L.map(id, {
  dragging: true,
  scrollWheelZoom: true,
  touchZoom: true,
  doubleClickZoom: true,
  boxZoom: true,
  keyboard: true
 });
}
function initMap() {
 if (!window.L) { $('#map').innerHTML = '<p class="offline-map">Не удалось загрузить карту. Проверьте подключение к интернету и перезагрузите страницу.</p>'; return; }
 state.map = createInteractiveMap('map').setView([state.lat,state.lon],11); addTiles(state.map);
 if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(() => state.map.invalidateSize({ pan: false }));
  observer.observe(state.map.getContainer());
 }
 state.air = L.layerGroup().addTo(state.map); state.reportsLayer = L.layerGroup().addTo(state.map); renderReports();
}
function setCity(name,country,lat,lon,source='search') {
 state.city=name; state.country=country; state.lat=Number(lat);state.lon=Number(lon); $$('.city-name').forEach(n=>n.textContent=name); $('.country-name').textContent=country;
 $('.data-note').textContent = (source==='geolocation' ? 'Местоположение определено с вашего разрешения.' : 'Выбрано место: '+name+'.') + ' Данные API — прогноз модели CAMS, а не измерения местной станции.';
 state.map?.setView([state.lat,state.lon],11); $('#search-results').hidden=true; loadAir();
}
$('#search-form').addEventListener('submit',async event=>{
 event.preventDefault(); const query=$('#city-search').value.trim(); if(query.length<2) return;
 searchController?.abort(); const controller = new AbortController(); searchController=controller;
 const results=$('#search-results');results.hidden=false;results.innerHTML='<p>Ищем место…</p>';
 try {
  const data=await getJSON('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q:query,format:'jsonv2',limit:'5','accept-language':'ru'}),controller.signal);
  if(controller!==searchController)return;results.replaceChildren();
  if(!data.length){results.innerHTML='<p>Место не найдено. Попробуйте уточнить название.</p>';return;}
  data.forEach(item=>{const button=document.createElement('button');button.type='button';button.textContent=item.display_name;button.addEventListener('click',()=>{setCity(item.name||item.display_name.split(',')[0],item.display_name.split(',').at(-1).trim(),item.lat,item.lon);$('#city-search').value='';});results.append(button);});
 } catch {if(controller===searchController)results.innerHTML='<p>Поиск недоступен. Попробуйте позже.</p>';}
});
$('#choose-city').addEventListener('click',()=>{$('#map-section').scrollIntoView({behavior:'smooth'});$('#city-search').focus({preventScroll:true});});
$('#refresh').addEventListener('click',loadAir);
$('#sensitive-mode').addEventListener('change', event => {
 state.sensitive = event.target.checked;
 renderActivities();
 state.air?.clearLayers();
 renderAirPoints(state.airRows, state.airPoints);
});
$('#filter-button').addEventListener('click',()=>{$('#layer-menu').hidden=!$('#layer-menu').hidden;$('#filter-button').setAttribute('aria-expanded',String(!$('#layer-menu').hidden));});
$('#air-layer').addEventListener('change',event=>{if(!state.map)return;event.target.checked?state.map.addLayer(state.air):state.map.removeLayer(state.air);});
$('#reports-layer').addEventListener('change',event=>{if(!state.map)return;event.target.checked?state.map.addLayer(state.reportsLayer):state.map.removeLayer(state.reportsLayer);});
$('#expand-map').addEventListener('click',()=>{const expanded=$('#map-section').classList.toggle('expanded');$('#expand-map').textContent=expanded?'Свернуть ↙':'Развернуть ↗';setTimeout(()=>state.map?.invalidateSize(),80);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#search-results').hidden=true;$('#layer-menu').hidden=true;$('#filter-button').setAttribute('aria-expanded','false');if($('#map-section').classList.contains('expanded'))$('#expand-map').click();}});
$('#locate').addEventListener('click',()=>{
 if(!navigator.geolocation){toast('Геолокация не поддерживается вашим браузером. Используйте поиск.');return;}
 $('#locate').disabled=true;toast('Запрашиваем ваше местоположение…');
 navigator.geolocation.getCurrentPosition(position=>{$('#locate').disabled=false;setCity('Моё местоположение','',position.coords.latitude,position.coords.longitude,'geolocation');},()=>{$('#locate').disabled=false;toast('Не удалось определить местоположение. Выберите город через поиск.');},{timeout:12000,maximumAge:60000});
});
async function toggleNotifications(){
 if(storage.read('dustalert-notifications',false)){if(storage.write('dustalert-notifications',false)){notificationLabel();toast('Уведомления DustAlert отключены.');}return;}
 if(!('Notification' in window)||!window.isSecureContext){toast('Этот браузер не поддерживает уведомления здесь. Нужен HTTPS или localhost.');return;}
 try {const permission=await Notification.requestPermission();if(permission==='granted'){if(storage.write('dustalert-notifications',true)){notificationLabel();toast('Уведомления включены при открытой странице. Проверка каждые 15 минут.');loadAir();}}else toast('Разрешение не получено. Предупреждения останутся на странице.');}catch{toast('Не удалось включить системные уведомления в этом браузере.');}
}
function notificationLabel(){const enabled=storage.read('dustalert-notifications',false)&&'Notification'in window&&Notification.permission==='granted';$('#notification-button span').textContent=enabled?'Отключить уведомления':'Включить уведомления';$('#notification-button').title='Проверка каждые 15 минут при открытой странице';}
$('#notification-button').addEventListener('click',toggleNotifications);$('#notification-top').addEventListener('click',toggleNotifications);
$$('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
$$('[data-report]').forEach(button=>button.addEventListener('click',()=>{
 if(!window.L){toast('Для выбора точки нужна карта. Проверьте подключение и перезагрузите страницу.');return;}
 $('#report-dialog').showModal();
 if(!state.reportMap){state.reportMap=createInteractiveMap('report-map');addTiles(state.reportMap);state.reportMap.on('click',event=>{state.point=event.latlng;$('#report-location').value=event.latlng.lat.toFixed(5)+', '+event.latlng.lng.toFixed(5);if(state.chosenMarker)state.chosenMarker.setLatLng(event.latlng);else state.chosenMarker=L.marker(event.latlng).addTo(state.reportMap);});}
 state.reportMap.setView(state.point||[state.lat,state.lon],12);setTimeout(()=>state.reportMap.invalidateSize(),70);
}));
$('#report-photo').addEventListener('change',async event=>{
 const file=event.target.files[0];state.photo=null;$('#photo-preview').hidden=true;$('#report-error').textContent='';if(!file)return;
 if(file.size>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){$('#report-error').textContent='Выберите JPG, PNG или WebP размером до 3 МБ.';event.target.value='';return;}
 const submit=$('#report-form button[type="submit"]');submit.disabled=true;
 try{const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();state.photo=canvas.toDataURL('image/jpeg',.75);$('#photo-preview').src=state.photo;$('#photo-preview').hidden=false;}catch{$('#report-error').textContent='Не удалось прочитать изображение. Выберите другой файл.';event.target.value='';}finally{submit.disabled=false;}
});
$('#report-form').addEventListener('submit',event=>{
 event.preventDefault();if(!state.point){$('#report-error').textContent='Сначала выберите место нажатием на карту.';return;}
 const description=$('#report-description').value.trim();if(!description){$('#report-error').textContent='Добавьте описание проблемы.';return;}
 const report={id:crypto.randomUUID(),lat:state.point.lat,lon:state.point.lng,type:$('#report-type').value,description,photo:state.photo,date:new Date().toISOString()};
 const next=[...state.reports,report];if(!storage.write('dustalert-reports',next))return;state.reports=next;renderReports();$('#report-dialog').close();$('#report-form').reset();state.photo=null;state.point=null;if(state.chosenMarker){state.chosenMarker.remove();state.chosenMarker=null;}$('#photo-preview').hidden=true;$('#report-error').textContent='';
 $('#reports-layer').checked=true;state.map.addLayer(state.reportsLayer);state.map.setView([report.lat,report.lon],14);$('#map-section').scrollIntoView({behavior:'smooth'});toast('Сообщение сохранено на этом устройстве. Городским службам оно не отправлялось.');
});
function renderReports(){
 if(!state.reportsLayer)return;state.reportsLayer.clearLayers();
 state.reports.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)).forEach(report=>{
  const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=report.type;const description=document.createElement('p');description.textContent=report.description;const note=document.createElement('small');note.textContent='Ваше сообщение · '+new Date(report.date).toLocaleDateString('ru-RU')+' · Не проверено';popup.append(title,description,note);
  if(typeof report.photo==='string'&&report.photo.startsWith('data:image/')){const img=document.createElement('img');img.src=report.photo;img.alt='Фото участка';img.className='popup-photo';popup.append(img);}
  const remove=document.createElement('button');remove.textContent='Удалить моё сообщение';remove.className='popup-remove';remove.addEventListener('click',()=>{const next=state.reports.filter(r=>r.id!==report.id);if(storage.write('dustalert-reports',next)){state.reports=next;renderReports();toast('Сообщение удалено с устройства.');}});popup.append(document.createElement('br'),remove);
  L.marker([report.lat,report.lon],{icon:L.divIcon({className:'report-marker',html:'◇',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(state.reportsLayer).bindPopup(popup);
 });
}
const tips={
 home:{title:'Меньше пыли дома',items:['Протирайте поверхности влажной тканью: это помогает убрать осевшую пыль, не поднимая её в воздух.','Убирайте обувь у входа и регулярно стирайте текстиль, на котором накапливается пыль.','При сильной пыли снаружи закройте окна, если температура в помещении остаётся безопасной. Проветрите, когда воздух станет чище.','Если используете очиститель воздуха, выбирайте подходящий размер помещения и меняйте фильтры по инструкции.']},
 health:{title:'Как защититься в пыльный день',items:['Проверяйте качество воздуха перед прогулкой. При высоком загрязнении сократите длительное пребывание и интенсивную физическую нагрузку на улице.','Детям, пожилым людям и людям с заболеваниями сердца или лёгких стоит особенно внимательно следить за самочувствием.','Закройте окна в периоды сильной запылённости, если в помещении не становится опасно жарко.','Если выходить необходимо, подходящий, плотно прилегающий респиратор N95 или FFP2 может уменьшить вдыхание частиц. Он не защищает от всех газов.','При ухудшении самочувствия прекратите нагрузку и обратитесь за медицинской помощью. Следуйте индивидуальным рекомендациям вашего врача.'],source:true},
 street:{title:'Как уменьшить пыль на улицах',items:['Избегайте сухого подметания пыльных участков: оно снова поднимает частицы в воздух.','Не нарушайте растительный покров и не паркуйтесь на газонах и открытом грунте.','О пыльных дорогах и строительных площадках сообщайте ответственным городским службам через официальные каналы.','В DustAlert нажмите «Сообщить о пыли», выберите точку на карте, тип проблемы и добавьте описание или фото. Запись сохранится только в вашем браузере.']},
 trees:{title:'Больше зелени вокруг',items:['Деревья дают тень, а растительный покров помогает защищать открытый грунт от разнесения ветром.','Согласовывайте посадки с владельцем участка и выбирайте виды, подходящие местному климату.','Уход и полив после посадки так же важны, как новые саженцы. Учитывайте доступность воды.','Присоединяйтесь к проверенным инициативам по озеленению и сохранению существующих деревьев.']}
};
$$('[data-tip]').forEach(button=>button.addEventListener('click',()=>{const tip=tips[button.dataset.tip];$('#tip-title').textContent=tip.title;$('#tip-content').innerHTML='<ul>'+tip.items.map(item=>'<li>'+escapeHTML(item)+'</li>').join('')+'</ul>'+(tip.source?'<a href="https://www.airnow.gov/publications/air-quality-index/air-quality-guide-for-particle-pollution/" target="_blank" rel="noopener">Рекомендации AirNow о загрязнении частицами ↗</a>':'');$('#tip-dialog').showModal();}));
$('#add-event').addEventListener('click',()=>$('#event-dialog').showModal());
$('#event-form').addEventListener('submit',event=>{event.preventDefault();const title=$('#event-title').value.trim(),place=$('#event-place').value.trim(),date=$('#event-date').value;if(!title||!place||!Number.isFinite(new Date(date).getTime())){toast('Заполните название, место и дату мероприятия.');return;}const next=[...state.events,{id:crypto.randomUUID(),title,place,date,type:$('#event-type').value}];if(!storage.write('dustalert-events',next))return;state.events=next;renderEvents();$('#event-dialog').close();$('#event-form').reset();toast('Мероприятие добавлено в ваш локальный список.');});
function renderEvents(){const list=$('#event-list');list.replaceChildren();if(!state.events.length){const p=document.createElement('p');p.className='empty-events';p.textContent='Пока нет добавленных мероприятий. Подтверждённая городская афиша не подключена.';list.append(p);return;}[...state.events].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(event=>{const article=document.createElement('article'),div=document.createElement('div'),h=document.createElement('h3'),p=document.createElement('p'),remove=document.createElement('button');h.textContent=event.title;p.textContent=event.type+' · '+new Date(event.date).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+' · '+event.place+' · Личная запись';div.append(h,p);remove.textContent='Удалить';remove.addEventListener('click',()=>{const next=state.events.filter(item=>item.id!==event.id);if(storage.write('dustalert-events',next)){state.events=next;renderEvents();}});article.append(div,remove);list.append(article);});}
$$('.nav-link').forEach(link=>link.addEventListener('click',()=>{$$('.nav-link').forEach(n=>n.classList.remove('active'));link.classList.add('active');$('.breadcrumb strong').textContent=link.textContent.trim();}));
const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){const link=$('.nav-link[href="#'+entry.target.id+'"]');if(link){$$('.nav-link').forEach(n=>n.classList.remove('active'));link.classList.add('active');$('.breadcrumb strong').textContent=link.textContent.trim();}}});},{rootMargin:'-5% 0px -65% 0px',threshold:0});
['home','map-section','alerts','tips','events'].forEach(id=>observer.observe(document.getElementById(id)));
$('#today').textContent=new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
notificationLabel();renderEvents();initMap();loadAir();
setInterval(()=>{if(document.visibilityState==='visible')loadAir();},15*60*1000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadAir();});
