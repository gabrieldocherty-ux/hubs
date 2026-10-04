import { ComingSoon } from '../../components/ComingSoon';
import './brands.css';

/** Placeholder until package B lands: the public brand page, `#/b/:slug`. */
export default function BrandPage({ slug }: { slug: string }) {
  return <ComingSoon title="Brand page" detail={`Brand ${slug}`} />;
}
