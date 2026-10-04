import { ComingSoon } from '../../components/ComingSoon';
import './generate.css';

/** Placeholder until package D lands: "Describe your kitchen", `#/generate?q=&from=`. */
export default function GenerateScreen({ q }: { q?: string; from?: string }) {
  return <ComingSoon title="Describe your kitchen" detail={q ? `"${q}"` : 'Describe a kitchen and pick from five generated layouts.'} />;
}
