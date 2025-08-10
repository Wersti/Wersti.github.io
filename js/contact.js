document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  const successMessage = document.getElementById('successMessage');

  form.addEventListener('submit', e => {
    e.preventDefault();

    const formData = new FormData(form);

    fetch(form.action, {
      method: form.method,
      body: formData,
      headers: {
        'Accept': 'application/json'
      }
    })
      .then(response => {
        if (response.ok) {
          successMessage.style.display = 'block';
          form.reset();
        } else {
          return response.json().then(data => {
            if (Object.hasOwn(data, 'errors')) {
              alert(data["errors"].map(error => error.message).join(", "));
            } else {
              alert('Error enviando el mensaje');
            }
          });
        }
      })
      .catch(() => {
        alert('Error enviando el mensaje');
      });
  });
});
