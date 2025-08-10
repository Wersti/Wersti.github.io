// Menú responsive simple (si quieres luego agregar hamburguesa, pero por ahora navegación básica)
// Puedes agregar más funcionalidades comunes aquí

document.addEventListener('DOMContentLoaded', () => {
  // Marcar el enlace activo en el menú según la página
  const currentPage = window.location.pathname.split("/").pop();
  const navLinks = document.querySelectorAll('nav a');

  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
});
