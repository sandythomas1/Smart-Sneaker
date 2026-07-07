import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@smart-sneaker/data-contracts';
import { computeOnPhoneInsights } from '../insights/compute-on-phone';
import { buildInsightsViewModel, InsightCardViewModel } from '../insights/view-model';

export interface InsightsScreenProps {
  /** The just-recorded session (T9's output). */
  session: Session;
}

/**
 * Post-session insights view (Req. 4): computes all four running insights via
 * the shared engine, on-phone, inside a render-time memo — no network call on
 * this path, so it works identically in airplane mode. Every card carries its
 * confidence, and unreliable insights are shown dimmed with their caveat
 * rather than hidden (Req. 11).
 */
export function InsightsScreen({ session }: InsightsScreenProps): React.JSX.Element {
  const state = useMemo(() => computeOnPhoneInsights(session), [session]);

  if (state.status === 'unavailable') {
    return (
      <View style={styles.container} testID="insights-unavailable">
        <Text style={styles.heading}>Session saved</Text>
        <Text style={styles.note}>{state.reason}</Text>
      </View>
    );
  }

  const viewModel = buildInsightsViewModel(state.insights);
  return (
    <ScrollView style={styles.container} testID="insights-ready">
      <Text style={styles.heading}>Your session insights</Text>
      <Text style={styles.note}>
        Computed on your phone — final results sync to your dashboard.
      </Text>
      {viewModel.cards.map((card) => (
        <InsightCard key={card.key} card={card} />
      ))}
    </ScrollView>
  );
}

function InsightCard({ card }: { card: InsightCardViewModel }): React.JSX.Element {
  return (
    <View style={[styles.card, !card.reliable && styles.cardUnreliable]} testID={`card-${card.key}`}>
      <Text style={styles.cardTitle}>{card.title}</Text>
      <Text style={styles.cardValue} testID={`value-${card.key}`}>
        {card.valueText}
      </Text>
      <Text style={styles.confidence} testID={`confidence-${card.key}`}>
        {card.reliable
          ? `Confidence: ${card.confidencePercent}%`
          : `Unreliable (confidence ${card.confidencePercent}%)`}
      </Text>
      {card.note !== undefined && <Text style={styles.note}>{card.note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginTop: 12,
  },
  cardUnreliable: { opacity: 0.55 },
  cardTitle: { fontSize: 14, color: '#555' },
  cardValue: { fontSize: 24, fontWeight: '700', marginVertical: 2 },
  confidence: { fontSize: 12, color: '#777' },
  note: { fontSize: 12, color: '#999', marginTop: 4 },
});
