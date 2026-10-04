import { ComingSoon } from '../../components/ComingSoon';
import './share.css';

/** Placeholder until package E lands: the read-only shared kitchen, `#/s/:token`. */
export default function SharedKitchen({ token }: { token: string }) {
  return <ComingSoon title="Shared kitchen" detail={`Link ${token.slice(0, 6)}…`} />;
}
