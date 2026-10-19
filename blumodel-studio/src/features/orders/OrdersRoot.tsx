import { OrdersList } from './OrdersList';
import { OrderPage } from './OrderPage';
import { RequestWizard } from './RequestWizard';
import { OrdersShell } from './parts';
import './orders.css';

const ORDER_ID = /^o_[a-z0-9]{24}$/;

/**
 * `#/orders/<rest>` (BUILD_PLAN §7 C-T5): the list, the request wizard (`new?ref=&brand=&target=`)
 * and an order's page. The router hands over the free `rest` sub-path.
 */
export default function OrdersRoot({ rest }: { rest: string }) {
  if (!rest) return <OrdersList />;
  if (rest === 'new') return <RequestWizard />;
  if (ORDER_ID.test(rest)) return <OrderPage key={rest} id={rest} />;
  return (
    <OrdersShell>
      <div className="screen-msg">
        <p>That page doesn’t exist.</p>
        <a className="btn" href="#/orders">
          Back to my custom models
        </a>
      </div>
    </OrdersShell>
  );
}
