# Network Comparison Chart Feature

## Overview

The Network Comparison Chart feature (Issue #243) provides side-by-side trend visualization for comparing mainnet and testnet performance metrics in the Stellar Analytics Dashboard.

## Features

### Multi-Network Comparison
- **Side-by-side visualization**: Compare mainnet and testnet metrics in a single view
- **Distinct color coding**: Mainnet (primary color) and testnet (warning color) for easy identification
- **Synchronized time ranges**: Both networks display data for the same time period

### Metric Selection
Users can compare different performance metrics:
- **Transaction Count**: Number of transactions over time
- **Operation Count**: Number of operations over time
- **Average Fee**: Average transaction fee in stroops
- **Success Rate**: Transaction success rate percentage

### Time Range Options
- **24 Hours**: Recent performance data
- **7 Days**: Weekly trend analysis
- **30 Days**: Monthly performance overview

### Data Export
- Export comparison data in multiple formats (CSV, JSON)
- Filename includes metric type and time range for easy identification
- Integrated with existing ExportControls component

### Auto-Refresh
- Data automatically refreshes every 30 seconds
- Manual refresh button available
- Loading indicator during data updates

## Implementation Details

### API Changes

#### Schema Updates (`api/src/schema.ts`)
Added new GraphQL types and queries:

```graphql
type Stats {
  totalLedgers: Int!
  totalTransactions: Int!
  totalOperations: Int!
  totalAccounts: Int!
  totalAssets: Int!
  activeAccounts24h: Int!
  volume24h: String!
  averageFee24h: Float!
  successRate24h: Float!
  latestLedger: Int!
  latestLedgerTime: String!
}

type NetworkMetrics {
  timestamp: String!
  transactionCount: Int!
  operationCount: Int!
  activeAccounts: Int!
  totalVolume: String!
  averageFee: Float!
  successRate: Float!
}

input TimeRangeInput {
  startTime: String
  endTime: String
}

type Query {
  stats: Stats!
  networkMetrics(timeRange: TimeRangeInput): [NetworkMetrics!]!
}
```

#### Resolver Updates (`api/src/resolvers/index.ts`)
- **stats**: Aggregates overall network statistics from database
- **networkMetrics**: Returns time-series data for trend visualization with configurable time ranges

### Frontend Components

#### NetworkComparisonChart (`frontend/src/components/NetworkComparisonChart.tsx`)
Main component implementing the comparison chart:

**Key Features:**
- Metric selector dropdown
- Time range selector dropdown
- Dual bar chart visualization
- Network legend with color coding
- Per-network total summaries
- Export controls integration
- Loading and error states
- Auto-refresh with 30s interval

**State Management:**
```typescript
const [selectedMetric, setSelectedMetric] = useState<MetricType>('transactionCount');
const [timeRange, setTimeRange] = useState<TimeRange>('24h');
```

#### Dashboard Integration (`frontend/src/pages/DashboardPage.tsx`)
Added NetworkComparisonChart to the dashboard tab below the existing TransactionsChart:

```tsx
<div className="grid" style={{ marginTop: '24px' }}>
  <NetworkComparisonChart />
</div>
```

### Internationalization

Added translation key `chart.networkComparison` to all supported languages:
- English: "Network Comparison"
- German: "Netzwerkvergleich"
- Spanish: "Comparación de red"
- French: "Comparaison de réseau"
- Japanese: "ネットワーク比較"
- Chinese: "网络比较"

## Usage

### Viewing the Chart
1. Navigate to the Dashboard tab
2. Scroll down to the "Network Comparison" section
3. The chart displays mainnet and testnet data side-by-side

### Changing Metrics
1. Use the metric dropdown selector
2. Choose from: Transactions, Operations, Avg Fee, or Success Rate
3. Chart updates immediately with new metric data

### Adjusting Time Range
1. Use the time range dropdown selector
2. Choose from: 24 Hours, 7 Days, or 30 Days
3. Chart refreshes with data for the selected period

### Exporting Data
1. Click the export button in the chart header
2. Select desired format (CSV, JSON)
3. File downloads with naming pattern: `network-comparison-{metric}-{timeRange}.{format}`

### Manual Refresh
1. Click the refresh button (↻) in the chart header
2. Chart reloads data from the API
3. Loading indicator shows during refresh

## Data Flow

1. **Component Mount**: NetworkComparisonChart initializes with default metric (transactionCount) and time range (24h)
2. **API Query**: Component queries `networkMetrics` GraphQL endpoint with time range parameters
3. **Data Processing**: Response is mapped to MetricPoint interface
4. **Testnet Simulation**: Testnet data is simulated (production would query separate endpoint)
5. **Visualization**: Dual bar charts render with network-specific colors
6. **Auto-Refresh**: Polling every 30s updates data automatically

## Future Enhancements

### Production Improvements
- **Real Multi-Network Data**: Replace simulated testnet data with actual API calls to testnet endpoints
- **Network Configuration**: Add support for custom network endpoints
- **Advanced Metrics**: Add more comparison metrics (TPS, latency, etc.)
- **Chart Types**: Support line charts, area charts, and stacked visualizations
- **Data Normalization**: Option to normalize data for percentage-based comparisons

### Performance Optimizations
- **Data Caching**: Implement client-side caching for time range data
- **Lazy Loading**: Load chart data only when visible
- **WebSocket Updates**: Replace polling with real-time subscriptions
- **Data Aggregation**: Server-side aggregation for large time ranges

### UI/UX Improvements
- **Responsive Design**: Better mobile layout for side-by-side charts
- **Interactive Tooltips**: Detailed hover information for data points
- **Zoom/Pan**: Interactive time range selection
- **Custom Time Ranges**: Allow user-defined date ranges
- **Comparison Mode**: Toggle between absolute and relative values

## Testing

### Manual Testing Checklist
- [ ] Chart renders correctly on dashboard
- [ ] Metric selector changes chart data
- [ ] Time range selector updates time period
- [ ] Export functionality works for all formats
- [ ] Manual refresh button updates data
- [ ] Auto-refresh occurs every 30s
- [ ] Loading state displays correctly
- [ ] Error state handles API failures
- [ ] Empty state displays when no data
- [ ] Translations work for all languages
- [ ] Responsive layout on different screen sizes

### API Testing
```graphql
query GetNetworkMetrics {
  networkMetrics(timeRange: {
    startTime: "2024-01-01T00:00:00Z"
    endTime: "2024-01-02T00:00:00Z"
  }) {
    timestamp
    transactionCount
    operationCount
    averageFee
    successRate
  }
}

query GetStats {
  stats {
    totalLedgers
    totalTransactions
    totalOperations
    totalAccounts
    activeAccounts24h
    volume24h
    averageFee24h
    successRate24h
    latestLedger
    latestLedgerTime
  }
}
```

## Troubleshooting

### Chart Not Loading
- Check API server is running on port 4000
- Verify GraphQL endpoint is accessible
- Check browser console for network errors
- Ensure database has sufficient data

### No Data Displayed
- Verify indexer is syncing data
- Check database has records for selected time range
- Try shorter time range (24h instead of 30d)
- Check API logs for query errors

### Testnet Data Incorrect
- Note: Current implementation uses simulated testnet data
- Production requires separate testnet API endpoint
- Check network configuration in `shared/src/config/networks.ts`

### Export Not Working
- Verify ExportControls component is properly imported
- Check browser download permissions
- Ensure data is available before export
- Check console for export-related errors

## Related Files

- `frontend/src/components/NetworkComparisonChart.tsx` - Main chart component
- `frontend/src/pages/DashboardPage.tsx` - Dashboard integration
- `frontend/src/graphql/queries.ts` - GraphQL queries
- `api/src/schema.ts` - GraphQL schema definitions
- `api/src/resolvers/index.ts` - GraphQL resolvers
- `shared/src/config/networks.ts` - Network configuration
- `frontend/src/i18n/locales/*.json` - Translation files

## Dependencies

### Existing
- `@apollo/client` - GraphQL client
- `react-i18next` - Internationalization
- Existing chart components and utilities

### No New Dependencies Required
The implementation uses existing dependencies and follows the established patterns in the codebase.
