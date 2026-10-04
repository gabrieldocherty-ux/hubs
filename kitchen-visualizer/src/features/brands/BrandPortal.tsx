import { ComingSoon } from '../../components/ComingSoon';
import './brands.css';

/** Placeholder until package B lands: the brand portal, `#/brand/<rest>`. */
export default function BrandPortal({ rest }: { rest: string }) {
  return <ComingSoon title="Brand portal" detail={rest ? `#/brand/${rest}` : 'List your products on Mise.'} />;
}
