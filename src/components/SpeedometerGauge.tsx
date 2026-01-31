interface SpeedometerGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  history?: number[]
  color?: string
}

export default function SpeedometerGauge({
  value,
  max = 100,
  label,
  unit = '%',
  history = [],
  color = '#3b82f6'
}: SpeedometerGaugeProps) {
  const percentage = Math.min((value / max) * 100, 100)
  const angle = (percentage / 100) * 180 - 90 // -90 to 90 degrees

  // Color based on value
  const getColor = () => {
    if (percentage > 80) return '#ef4444' // red
    if (percentage > 60) return '#f59e0b' // amber
    return color // default blue
  }

  const currentColor = getColor()

  // SVG arc path calculation
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

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path
          d={describeArc(cx, cy, radius, startAngle, endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          className="text-gray-200 dark:text-gray-700"
        />
        {/* Value arc */}
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
        {/* Needle */}
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
        {/* Tick marks */}
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
      {/* Value below gauge */}
      <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-4">
        {value.toFixed(1)}{unit}
      </div>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-1">{label}</div>

      {/* Area chart */}
      {history.length > 0 && (
        <div className="mt-3 w-full">
          <svg width="100%" height="40" viewBox="0 0 300 40" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`gradient-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.6" />
                <stop offset="100%" stopColor={color} stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {(() => {
              const data = history.slice(-30)
              const width = 300
              const height = 40
              const stepX = width / (data.length - 1 || 1)

              // Build area path
              let areaPath = `M 0 ${height}`
              data.forEach((val, i) => {
                const x = i * stepX
                const y = height - (val / max) * height
                areaPath += ` L ${x} ${y}`
              })
              areaPath += ` L ${width} ${height} Z`

              // Build line path
              let linePath = ''
              data.forEach((val, i) => {
                const x = i * stepX
                const y = height - (val / max) * height
                linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
              })

              return (
                <>
                  <path d={areaPath} fill={`url(#gradient-${label.replace(/\s+/g, '-')})`} />
                  <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
                </>
              )
            })()}
          </svg>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>30s ago</span>
            <span>now</span>
          </div>
        </div>
      )}
    </div>
  )
}
