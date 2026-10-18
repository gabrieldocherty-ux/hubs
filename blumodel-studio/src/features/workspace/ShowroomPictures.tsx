import { useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useDesignStore } from '../../store/useDesignStore';
import { brandKey } from '../../lib/generate/brands';
import { imagesApi, shrinkPhoto, type ImageTarget } from '../showroom/images/api';
import type { ShowroomImages, ShowroomPic } from '../showroom/site';
import type { StaffTenant } from './api';

type Sources = { render: ShowroomImages; photo: ShowroomImages };

/**
 * The Showroom tab's pictures: what the landing page shows at the top and on each featured line,
 * where each came from (made by our 3D renderer from your products, or your own photo), a way to
 * make them again, and your own photos, which always win. Changes apply at once (not with Save).
 */
export function ShowroomPictures({ tenant, featured, onChange }: { tenant: StaffTenant; featured: string[]; onChange: (t: StaffTenant) => void }) {
  const toast = useDesignStore((s) => s.toast);
  const src = tenant.imageSources;
  const rendered = tenant.images?.renderedAt ? new Date(tenant.images.renderedAt) : null;
  const apply = (r: { images: ShowroomImages; imageSources: Sources }) => onChange({ ...tenant, images: r.images, imageSources: r.imageSources });

  return (
    <fieldset className="ws-card ws-pics">
      <legend>Showroom pictures</legend>
      <p className="fine">
        The top of your landing page and each featured line show a picture of a finished kitchen made with your own products. We make them with the same 3D renderer your customers use; upload a
        photo of your own work to show that instead.
      </p>
      <div className="ws-pics-actions">
        <a className="btn primary" href="#/showroom-images" target="_blank" rel="noopener">
          Generate showroom images
        </a>
        <span className="muted">{rendered ? `Last made ${rendered.toLocaleDateString()}. Make them again after adding products or lines.` : 'Not made yet. It takes a minute or two, in your browser.'}</span>
      </div>
      <ul className="ws-pics-list">
        <PicRow label="Main picture" target={{ slot: 'hero', source: 'photo' }} render={src?.render.hero ?? null} photo={src?.photo.hero ?? null} onDone={apply} toast={toast} />
        {featured.map((l) => {
          const k = brandKey(l);
          return <PicRow key={l} label={l} target={{ slot: 'line', source: 'photo', line: l }} render={src?.render.lines[k] ?? null} photo={src?.photo.lines[k] ?? null} onDone={apply} toast={toast} />;
        })}
      </ul>
    </fieldset>
  );
}

function PicRow({ label, target, render, photo, onDone, toast }: { label: string; target: ImageTarget; render: ShowroomPic | null; photo: ShowroomPic | null; onDone: (r: { images: ShowroomImages; imageSources: Sources }) => void; toast: ReturnType<typeof useDesignStore.getState>['toast'] }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = photo ?? render;
  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const blob = await shrinkPhoto(file);
      onDone(await imagesApi.upload(blob, target));
      toast(`${label}: your photo is on the showroom.`, 'ok');
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : 'That photo didn’t upload.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      onDone(await imagesApi.remove(target));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Couldn’t remove it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="ws-pic">
      <span className="ws-pic-img">{shown ? <img src={shown.url} alt="" width={shown.w} height={shown.h} loading="lazy" /> : <i>No picture yet</i>}</span>
      <span className="ws-pic-text">
        <b>{label}</b>
        <span className="muted">{photo ? 'Your photo' : render ? 'Made from your products' : 'The plan view stands in until there is one'}</span>
        {err && <em className="ws-field-error">{err}</em>}
      </span>
      <span className="ws-actions">
        <button type="button" className="btn" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : photo ? 'Replace photo' : 'Upload a photo'}
        </button>
        {photo && (
          <button type="button" className="btn" onClick={() => void remove()} disabled={busy}>
            Use the render
          </button>
        )}
      </span>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => (e.target.files?.[0] && void upload(e.target.files[0]), (e.target.value = ''))} />
    </li>
  );
}
