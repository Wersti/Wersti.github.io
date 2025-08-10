document.addEventListener('DOMContentLoaded', () => {
  const projectsContainer = document.getElementById('github-projects');
  const username = 'Wersti'; // Cambia por tu usuario GitHub exacto

  fetch(`https://api.github.com/users/${username}/repos?sort=updated`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Error al cargar proyectos');
      }
      return response.json();
    })
    .then(repos => {
      if (repos.length === 0) {
        projectsContainer.innerHTML = '<p>No se encontraron proyectos.</p>';
        return;
      }

      projectsContainer.innerHTML = ''; // Limpiar

      repos.forEach(repo => {
        const card = document.createElement('div');
        card.classList.add('project-card');

        const title = document.createElement('h3');
        title.textContent = repo.name;

        const desc = document.createElement('p');
        desc.textContent = repo.description || 'Sin descripción';

        const link = document.createElement('a');
        link.href = repo.html_url;
        link.textContent = 'Ver en GitHub';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(link);

        projectsContainer.appendChild(card);
      });
    })
    .catch(error => {
      projectsContainer.innerHTML = `<p>${error.message}</p>`;
    });
});
