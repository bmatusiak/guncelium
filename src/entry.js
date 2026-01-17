import app from './runtime/rectifyApp';

// Keep Expo/RN UI bootstrap.
import './init';

app.on('error', (e) => {
    // Fail-fast: surface Rectify bootstrap errors.
    throw e;
});

// Boot services (gun/tor plugins) before UI interaction.
app.start('entry');

export default app;
