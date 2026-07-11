import './style.css';
import { App } from './app';

const app = new App();
app.bootstrap().catch(console.error);

// Expose for smoke testing
(window as unknown as { __app: App }).__app = app;
