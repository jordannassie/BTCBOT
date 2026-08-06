// WeatherCallHistory — Demo call history table.
// ALL rows are fabricated demonstration data, not actual trades.

interface HistoryRow {
  city:         string;
  bracket:      string;
  call:         string;
  entryPrice:   string;
  estProb:      string;
  result:       'WIN' | 'LOSS' | 'PENDING';
  pl:           string;
}

const DEMO_ROWS: HistoryRow[] = [
  {
    city:       'Dallas',
    bracket:    '99–100°F',
    call:       'TRADE',
    entryPrice: '64¢',
    estProb:    '81%',
    result:     'PENDING',
    pl:         '—',
  },
  {
    city:       'Phoenix',
    bracket:    '105–106°F',
    call:       'TRADE',
    entryPrice: '58¢',
    estProb:    '74%',
    result:     'WIN',
    pl:         '+$3.40',
  },
  {
    city:       'Miami',
    bracket:    '91–92°F',
    call:       'WAIT',
    entryPrice: '—',
    estProb:    '61%',
    result:     'LOSS',
    pl:         '$0.00',
  },
];

function ResultCell({ result }: { result: HistoryRow['result'] }) {
  if (result === 'WIN')     return <span className="weather-hist-result-win">WIN</span>;
  if (result === 'LOSS')    return <span className="weather-hist-result-loss">LOSS</span>;
  return <span className="weather-hist-result-pending">PENDING</span>;
}

function PlCell({ value }: { value: string }) {
  if (value.startsWith('+')) return <span className="weather-hist-pl-positive">{value}</span>;
  if (value.startsWith('-')) return <span className="weather-hist-pl-negative">{value}</span>;
  return <span>{value}</span>;
}

export default function WeatherCallHistory() {
  return (
    <section className="weather-history-section">
      <div className="weather-history-header">
        <span className="weather-history-title">Weather Call History</span>
        <span className="weather-history-demo-badge">Demo history — not actual trades</span>
      </div>

      <table className="weather-history-table">
        <thead>
          <tr>
            <th>City</th>
            <th>Bracket</th>
            <th>Call</th>
            <th>Entry Price</th>
            <th>Est. Probability</th>
            <th>Result</th>
            <th>Profit / Loss</th>
          </tr>
        </thead>
        <tbody>
          {DEMO_ROWS.map((row, i) => (
            <tr key={i}>
              <td className="weather-hist-cell-city">{row.city}</td>
              <td>{row.bracket}</td>
              <td>{row.call}</td>
              <td>{row.entryPrice}</td>
              <td>{row.estProb}</td>
              <td><ResultCell result={row.result} /></td>
              <td><PlCell value={row.pl} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
