/**
 * A catalog card's picture: the product's own 3D model in the kitchen's finishes (thumbStudio),
 * asked for once the card is on screen. Until it arrives, and whenever it can't be drawn, the flat
 * drawing (ProductArt) shows, so a card is never empty.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { Finish, Product, Surfaces } from '../../types';
import { ProductArt } from '../ProductArt';
import { cachedThumb, canThumb, forgetThumb, hurryThumb, thumbFor } from './thumbStudio';

interface Props {
  product: Product;
  surfaces: Surfaces;
  finish?: Finish;
  width?: number;
}

export const ProductThumb = memo(function ProductThumb({ product, surfaces, finish, width }: Props) {
  const able = canThumb(product) && !finish;
  const [url, setUrl] = useState<string | null>(() => (able ? cachedThumb(product, surfaces, width) ?? null : null));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!able) return setUrl(null);
    const have = cachedThumb(product, surfaces, width);
    if (have !== undefined) return setUrl(have);
    setUrl(null);
    const el = ref.current;
    let live = true;
    let asked = false;
    const ask = () => {
      if (asked) return hurryThumb(product, surfaces, width);
      asked = true;
      void thumbFor(product, surfaces, width).then((u) => live && setUrl(u));
    };
    if (!el || typeof IntersectionObserver === 'undefined') {
      ask();
      return () => void (live = false);
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && ask(), { rootMargin: '200px' });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
      if (asked && cachedThumb(product, surfaces, width) === undefined) forgetThumb(product, surfaces, width);
    };
  }, [able, product, surfaces, width]);

  return (
    <span ref={ref} className="product-thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <ProductArt product={product} surfaces={surfaces} finish={finish} width={width} />}
    </span>
  );
});
