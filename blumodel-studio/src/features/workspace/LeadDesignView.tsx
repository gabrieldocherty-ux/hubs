import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { Workspace } from '../../screens/Editor';
import { catalogReady, useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import { wsApi } from './api';

/**
 * `#/studio/leads/<id>/design/<designId>`: one of a lead's designs in the editor, view-only, for
 * the company's team ("Open in 3D" on the lead). The design is the visitor's: nothing here saves,
 * and there is no route by which the team could change it.
 */
export default function LeadDesignView({ leadId, designId }: { leadId: string; designId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([wsApi.leadDesign(leadId, designId), catalogReady(4000)])
      .then(([{ design }]) => {
        if (!live) return;
        if (design.doc.products) useCatalog.getState().registerSnapshots(design.doc.products);
        useSession.getState().openProject(null, 0);
        useDesignStore.getState().openReadOnly({ ...design.doc, name: design.name });
        setName(design.name);
        setState('ready');
      })
      .catch((e) => live && setState({ error: e instanceof ApiError ? e.message : 'This design couldn’t be opened.' }));
    return () => {
      live = false;
    };
  }, [leadId, designId]);

  const back = hrefFor({ name: 'studio', rest: `leads/${leadId}` });
  if (state === 'loading') return <div className="screen-msg">Opening the design…</div>;
  if (typeof state === 'object')
    return (
      <div className="ws-empty">
        <p>{state.error}</p>
        <a className="btn" href={back}>
          Back to this customer
        </a>
      </div>
    );
  return (
    <div className="ws-design-view" data-testid="lead-design-view">
      <Workspace
        projectId={null}
        mode="view"
        hideExport
        banner={
          <div className="ws-design-bar">
            <a className="btn" href={back}>
              ← Back to this customer
            </a>
            <span className="ws-design-bar-text">
              <b>{name}</b> <span className="muted">· view only, the customer’s own design</span>
            </span>
          </div>
        }
      />
    </div>
  );
}
