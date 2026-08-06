// WeatherPositions — Empty-state section for weather positions.
// No trading connection exists. This is UI preview only.

export default function WeatherPositions() {
  return (
    <section className="weather-positions-section">
      <div className="weather-positions-header">
        <span className="weather-positions-title">Weather Positions</span>
      </div>
      <div className="weather-positions-empty">
        No weather positions. Trading is not connected.
      </div>
    </section>
  );
}
