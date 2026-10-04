import { ComingSoon } from '../../components/ComingSoon';
import './viewer.css';

/** Placeholder until package A lands: the realistic product page, `#/p/:id?finish=`. */
export default function ProductPage({ id, finish }: { id: string; finish?: string }) {
  return <ComingSoon title="Product page" detail={`Product ${id}${finish ? ` · finish ${finish}` : ''}`} />;
}
