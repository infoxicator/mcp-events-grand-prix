if(new URLSearchParams(location.search).has('track')) await import('./race/flythrough'); else if(new URLSearchParams(location.search).has('race')) await import('./race/local'); else await import('./pong-web');
export {};
