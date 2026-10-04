import { ComingSoon } from '../../components/ComingSoon';
import './orders.css';

/** Placeholder until package C lands: custom-model orders, `#/orders/<rest>`. */
export default function OrdersRoot({ rest }: { rest: string }) {
  return <ComingSoon title="Custom 3D models" detail={rest ? `#/orders/${rest}` : 'Your custom-model orders will appear here.'} />;
}
