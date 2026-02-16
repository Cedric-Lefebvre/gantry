interface SpeedometerGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  history?: number[]
  color?: string
  onClick?: () => void
}

export default function SpeedometerGauge({
  value,
  max = 100,
  label,
  unit = '%',
  history = [],
  color = '#3b82f6',
  onClick,
}: SpeedometerGaugeProps) {
  const percentage = Math.min((value / max) * 100, 100)
  const angle = (percentage / 100) * 180 - 90

  const getColor = () => {
    if (percentage > 80) return '#ef4444'
    if (percentage > 60) return '#f59e0b'
    return color
  }

  const currentColor = getColor()

  const radius = 70
  const cx = 80
  const cy = 80
  const startAngle = -180
  const endAngle = 0

  const polarToCartesian = (centerX: number, centerY: number, r: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180
    return {
      x: centerX + r * Math.cos(angleInRadians),
      y: centerY + r * Math.sin(angleInRadians),
    }
  }

  const describeArc = (x: number, y: number, r: number, startAng: number, endAng: number) => {
    const start = polarToCartesian(x, y, r, endAng)
    const end = polarToCartesian(x, y, r, startAng)
    const largeArcFlag = endAng - startAng <= 180 ? '0' : '1'
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
  }

  const valueEndAngle = startAngle + (percentage / 100) * (endAngle - startAngle)
  const historyMinutes = Math.round(history.length / 60)

  return (
    <div
      className={`flex flex-col items-center ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <svg width="160" height="90" viewBox="0 0 160 90">
        <path
          d={describeArc(cx, cy, radius, startAngle, endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          className="text-gray-200 dark:text-gray-700"
        />
        {percentage > 0 && (
          <path
            d={describeArc(cx, cy, radius, startAngle, valueEndAngle)}
            fill="none"
            stroke={currentColor}
            strokeWidth="12"
            strokeLinecap="round"
            style={{ transition: 'all 0.3s ease-out' }}
          />
        )}
        <g transform={`rotate(${angle}, ${cx}, ${cy})`} style={{ transition: 'transform 0.3s ease-out' }}>
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - radius + 15}
            stroke={currentColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="6" fill={currentColor} />
        </g>
        {[0, 25, 50, 75, 100].map((tick) => {
          const tickAngle = -180 + (tick / 100) * 180
          const innerR = radius - 20
          const outerR = radius - 8
          const inner = polarToCartesian(cx, cy, innerR, tickAngle)
          const outer = polarToCartesian(cx, cy, outerR, tickAngle)
          return (
            <line
              key={tick}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="currentColor"
              strokeWidth="2"
              className="text-gray-400 dark:text-gray-500"
            />
          )
        })}
      </svg>
      <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-4">
        {value.toFixed(1)}{unit}
      </div>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-1">{label}</div>

      {history.length > 1 && (() => {
        const data = history
        const graphW = 260
        const graphH = 50
        const stepX = graphW / (data.length - 1 || 1)

        const dataMin = Math.min(...data)
        const dataMax = Math.max(...data)
        const range = dataMax - dataMin
        const padding = Math.max(range * 0.3, 2)
        const yMin = Math.max(0, dataMin - padding)
        const yMax = Math.min(max, dataMax + padding)
        const yRange = yMax - yMin || 1

        let areaPath = `M 0 ${graphH}`
        data.forEach((val, i) => {
          const x = i * stepX
          const y = graphH - ((val - yMin) / yRange) * graphH
          areaPath += ` L ${x} ${y}`
        })
        areaPath += ` L ${(data.length - 1) * stepX} ${graphH} Z`

        let linePath = ''
        data.forEach((val, i) => {
          const x = i * stepX
          const y = graphH - ((val - yMin) / yRange) * graphH
          linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
        })

        const totalSec = data.length
        const timeMarks: { label: string; pct: number }[] = []
        if (totalSec >= 240) {
          for (let m = 4; m >= 1; m--) {
            const sec = m * 60
            if (sec < totalSec) timeMarks.push({ label: `${m}m`, pct: 1 - sec / totalSec })
          }
        } else if (totalSec >= 60) {
          timeMarks.push({ label: '1m', pct: 1 - 60 / totalSec })
        } else if (totalSec >= 30) {
          timeMarks.push({ label: '30s', pct: 1 - 30 / totalSec })
        }

        return (
          <div className="mt-3 w-full">
            <div className="flex items-stretch gap-1">
              <div className="flex flex-col justify-between text-[9px] font-mono text-gray-400 w-7 shrink-0 text-right pr-0.5" style={{ height: graphH }}>
                <span>{yMax.toFixed(0)}{unit}</span>
                <span>{yMin.toFixed(0)}{unit}</span>
              </div>
              <div className="flex-1 min-w-0">
                <svg width="100%" height={graphH} viewBox={`0 0 ${graphW} ${graphH}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={`gradient-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity="0.6" />
                      <stop offset="100%" stopColor={color} stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  {timeMarks.map((tm, i) => (
                    <line key={i} x1={tm.pct * graphW} y1="0" x2={tm.pct * graphW} y2={graphH} stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,2" className="text-gray-300 dark:text-gray-600" />
                  ))}
                  <path d={areaPath} fill={`url(#gradient-${label.replace(/\s+/g, '-')})`} />
                  <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
                </svg>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-0.5">
                  <span>{historyMinutes >= 1 ? `${historyMinutes}m` : `${totalSec}s`}</span>
                  {timeMarks.map((tm, i) => (
                    <span key={i} style={{ position: 'absolute', left: `calc(${tm.pct * 100}%)` }}></span>
                  ))}
                  <span>now</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
