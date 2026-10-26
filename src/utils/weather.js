/**
 * 天气查询前端实现 —— #weather 命令底座。
 *
 * 数据源：open-meteo（免费、无需 key、支持 CORS：access-control-allow-origin: *）
 *  - 地理编码：geocoding-api.open-meteo.com（支持中文城市名）
 *  - 天气    ：api.open-meteo.com（current + daily）
 *
 * 与原 Java 服务端差异：不再依赖和风天气服务端 key，改为直连 open-meteo；
 * 展示结构尽量对齐原版：
 *  - #weather 北京       ：当前实况（日期/天气/当前温度/体感温度）
 *  - #weather 北京 -d 3/7：未来 3/7 天预报（日期/天气/最低~最高温度）
 */

const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast'

/** WMO weather code -> 中文天气文案（与和风天气措辞风格近似） */
const WMO_TEXT = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '雷阵雨伴冰雹'
}

function wmoText(code) {
  return WMO_TEXT[code] || '未知'
}

async function httpGetJson(url) {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!resp.ok) {
    throw new Error(`接口返回 ${resp.status}`)
  }
  return resp.json()
}

/** 中文城市名/拼音 -> 经纬度；返回展示名与坐标 */
async function geocode(location) {
  const url = `${GEO_API}?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`
  const data = await httpGetJson(url)
  const hit = data.results && data.results[0]
  if (!hit) {
    throw new Error(`未找到城市“${location}”，可尝试拼音或更完整地名，例如 #weather Beijing`)
  }
  const area = [hit.admin1, hit.country].filter(Boolean).join(' ')
  return {
    name: `${hit.name}${area ? ' ' + area : ''}`,
    latitude: hit.latitude,
    longitude: hit.longitude
  }
}

async function fetchWeather(lat, lon, days) {
  const forecastDays = days > 0 ? days : 1
  const url =
    `${FORECAST_API}?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    `&timezone=auto&forecast_days=${forecastDays}`
  return httpGetJson(url)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 表头：当前实况（对齐原版 now 展示） */
function renderNow(geo, data) {
  const cur = data.current || {}
  const daily = data.daily || {}
  const date = (daily.time && daily.time[0]) || (cur.time || '').slice(0, 10)
  const lines = []
  lines.push(`**${geo.name} 当前天气**`)
  lines.push('')
  lines.push('| 日期 | 天气 | 当前温度 | 体感温度 |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(
    `| ${date} | ${wmoText(cur.weather_code)} | ${cur.temperature_2m}℃ | ${cur.apparent_temperature}℃ |`
  )
  lines.push('')
  lines.push(`湿度 ${cur.relative_humidity_2m}%  |  数据来源：open-meteo`)
  return lines.join('\n')
}

/** 表头：未来 N 天预报（对齐原版 3D/7D 展示） */
function renderForecast(geo, data, days) {
  const daily = data.daily || {}
  const times = daily.time || []
  const lines = []
  lines.push(`**${geo.name} 未来${days}天天气预报**`)
  lines.push('')
  lines.push('| 日期 | 天气 | 温度 |')
  lines.push('| --- | --- | --- |')
  times.forEach((t, i) => {
    const max = daily.temperature_2m_max && daily.temperature_2m_max[i]
    const min = daily.temperature_2m_min && daily.temperature_2m_min[i]
    const parts = t.split('-')
    const md = parts.length === 3 ? `${parts[1]}-${parts[2]}` : t
    lines.push(`| ${md} | ${wmoText(daily.weather_code && daily.weather_code[i])} | ${min}℃ ~ ${max}℃ |`)
  })
  lines.push('')
  lines.push('数据来源：open-meteo')
  return lines.join('\n')
}

/**
 * 查询指定城市天气，返回可直接渲染进聊天的 markdown 文本。
 * @param {string} location 城市名（中文/拼音均可）
 * @param {number} days 0=当前实况；3/7=未来预报天数
 * @returns {Promise<string>}
 */
export async function queryWeather(location, days = 0) {
  const geo = await geocode(location)
  const data = await fetchWeather(geo.latitude, geo.longitude, days)
  return days > 0 ? renderForecast(geo, data, days) : renderNow(geo, data)
}
