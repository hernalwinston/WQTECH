// Adds a class to <html> before first paint so pages can hide
// content until auth state is known (the .auth-gate CSS lives in each page css).
document.documentElement.classList.add('auth-gate');
