/**
 * 摸鱼文案生成 —— #moyu 命令的前端实现（替代 Java commons MoYuTipsUtil）。
 *
 * 语义对齐 Java 版：
 *  - 今日问候（凌晨/上午/中午/下午/晚上） + 随机摸鱼语录
 *  - 距离周末（下一个周六）天数
 *  - 距离未来一年内各法定节假日（元旦/春节/清明/劳动/端午/中秋/国庆）天数
 * 节日判定用 lunar-javascript（npm 依赖 lunar-javascript，已在 package.json 引入）
 * 对齐 Java 的 nlf.calendar 公历 + 农历 + 节气(清明) 判定，输出顺序与 Java 一致。
 */
import { Lunar } from 'lunar-javascript'

const HELLOS = [
  '摸鱼能增加工作动力，摸鱼能放松筋骨舒展神经。人都是被摸鱼摸大的，摸鱼是人的天性，无论是顺境还是逆境，工作摸鱼，才不会被工作抛弃。',
  '工作再累，一定不要忘记摸鱼哦！有事没事起身去茶水间，去厕所，去廊道走走别老在工位上坐着，钱是老板的,但命是自己的。',
  '生活需要摸鱼，而不是认真工作。有时候你需要摸鱼，让工作顺其自然，不要过分担心，也不要过于细致的规划。学会摸鱼，不要逼自己逼得太紧。深呼吸。尘埃落定时你会再次看见森林中的树木。'
]

const ENDS = [
  '认认真真上班，这根本就不叫赚钱，那是用劳动换取报酬。只有偷懒，在上班的时候摸鱼划水，你才是从老板手里赚到了钱。最后，祝愿天下所有摸鱼人都能愉快的渡过每一天！'
]

/** 时段判定（对齐 Java amOrPm） */
function amOrPm(hour) {
  if (hour >= 0 && hour <= 6) return '凌晨'
  if (hour > 6 && hour < 12) return '上午'
  if (hour === 12) return '中午'
  if (hour >= 13 && hour <= 18) return '下午'
  return '晚上'
}

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 某一天的法定节日名集合（公历 + 农历 + 节气清明），无命中返回空数组 */
function collectFestivalNames(date) {
  const names = []
  const month = date.getMonth() + 1
  const day = date.getDate()

  // 公历节日（对齐 Java solar.getFestivals 中命中 FESTIVAL_FILTER 的部分）
  if (month === 1 && day === 1) names.push('元旦节')
  if (month === 5 && day === 1) names.push('劳动节')
  if (month === 10 && day === 1) names.push('国庆节')

  // 农历节日（对齐 Java lunar.getFestivals）
  const lunar = Lunar.fromDate(date)
  const lm = lunar.getMonth()
  const ld = lunar.getDay()
  if (lm === 1 && ld === 1) names.push('春节')
  if (lm === 5 && ld === 5) names.push('端午节')
  if (lm === 8 && ld === 15) names.push('中秋节')

  // 节气清明（对齐 Java lunar.getJieQi()=="清明"）
  if (lunar.getJieQi() === '清明') names.push('清明')

  return names
}

/**
 * 计算距未来一年内各法定节假日最近一次的天数。
 * 遍历从今天（含当天）到下一年 12-31，每个节日名只保留最先（最近）出现的一次；
 * 同一日期多节日用逗号连接（对齐 Java CollUtil.join + LinkedHashMap 去重语义）。
 */
function computeHolidayMap() {
  const today = new Date()
  const start = dayStart(today)
  // Java 范围：today ~ (now+1年) 的 12-31 23:59:59.999
  const end = new Date(today.getFullYear() + 1, 11, 31, 23, 59, 59, 999)

  const map = new Map()
  const cursor = new Date(start)
  while (cursor <= end) {
    const names = collectFestivalNames(cursor)
    if (names.length) {
      const key = names.join(',')
      if (!map.has(key)) {
        const days = Math.round((cursor.getTime() - start.getTime()) / 86400000)
        map.set(key, days)
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return map
}

/** 距下一个周六（不含今天）的天数，对齐 Java TemporalAdjusters.next(SATURDAY) */
function daysToNextSaturday(now) {
  const dow = now.getDay() // 0=周日 ... 6=周六
  let diff = (6 - dow + 7) % 7
  if (diff === 0) diff = 7
  return diff
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

/** 将单换行转为 markdown 硬换行（行尾两空格），空行保留为段落分隔 */
function mdBreak(text) {
  return text
    .split('\n')
    .map((line) => (line.trim() ? line + '  ' : line))
    .join('\n')
}

/**
 * 生成完整摸鱼文案（markdown 友好多行文本）。
 */
export function getMoyuTips() {
  const now = new Date()
  const holidayMap = computeHolidayMap()

  const festivalLines = []
  holidayMap.forEach((days, festival) => {
    festivalLines.push('距离' + festival + '还有' + days + '天')
  })

  const lines = [
    '【摸鱼总办】提醒您：',
    '',
    now.getMonth() + 1 + '月' + now.getDate() + '日 ' + amOrPm(now.getHours()) + '好，打工人！' + pick(HELLOS),
    '',
    '距离周末还有' + daysToNextSaturday(now) + '天'
  ]
  // Java 中 fStr 紧跟"距离周末"行，节日列表为空时 fStr 为空串
  festivalLines.forEach((l) => lines.push(l))
  lines.push('', pick(ENDS), '', '欢迎加入摸鱼技术交流群：754126966')

  return mdBreak(lines.join('\n'))
}
