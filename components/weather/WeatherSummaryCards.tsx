// WeatherSummaryCards — Four summary stat cards for the Weather Trading page.
// All values are demonstration data only. No API calls are made here.

interface WeatherSummaryCard {
  label: string;
  value: string;
}

const CARDS: WeatherSummaryCard[] = [
  { label: 'Markets Scanned',  value: '57' },
  { label: 'Supported Cities', value: '24' },
  { label: 'Qualified Calls',  value: '3'  },
  { label: 'Open Positions',   value: '0'  },
];

export default function WeatherSummaryCards() {
  return (
    <>
      <div className="weather-summary-row">
        {CARDS.map((card) => (
          <div key={card.label} className="weather-summary-card">
            <span className="weather-summary-card-value">{card.value}</span>
            <span className="weather-summary-card-label">{card.label}</span>
          </div>
        ))}
      </div>
      <p className="weather-demo-note">
        * All values above are demonstration data — no live market connection.
      </p>
    </>
  );
}
