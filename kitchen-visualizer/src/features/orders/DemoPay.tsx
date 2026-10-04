import { ComingSoon } from '../../components/ComingSoon';
import './orders.css';

/** Placeholder until package C lands: the clearly labelled demo checkout, `#/pay/demo/:orderId`. */
export default function DemoPay({ orderId }: { orderId: string }) {
  return <ComingSoon title="Demo payment" detail={`Order ${orderId}. No real money moves and no card details are collected.`} />;
}
