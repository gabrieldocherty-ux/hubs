import { RoomSetup } from './components/RoomSetup';
import { CatalogPanel } from './components/CatalogPanel';
import { DesignCanvas } from './components/DesignCanvas';
import { ItemPropertiesPanel } from './components/ItemPropertiesPanel';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Kitchen Visualizer</h1>
        <RoomSetup />
      </header>
      <main className="app-main">
        <CatalogPanel />
        <DesignCanvas />
        <ItemPropertiesPanel />
      </main>
    </div>
  );
}
