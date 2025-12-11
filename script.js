
const API = '';
const token = localStorage.getItem('token'); 

async function getItems() {
  const res = await fetch('/items');
  const items = await res.json();
  const container = document.getElementById('items');
  container.innerHTML = items.map(i => `
    <div class="item" data-id="${i.id}">
      <h3>${i.title}</h3>
      <p>${i.description || ''}</p>
      ${i.image ? `<img src="${i.image}" alt="" width="150" />` : ''}
      <div class="actions">
        <button onclick="editItem(${i.id})">Edit</button>
        <button onclick="deleteItem(${i.id})">Delete</button>
        <button onclick="addToCart(${i.id})">Add to cart</button>
      </div>
    </div>
  `).join('');
}

async function createItem(evt) {
  evt.preventDefault();
  const form = evt.target;
  const fd = new FormData(form);
  const res = await fetch('/items', {
    method: 'POST',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    body: fd
  });
  if (res.ok) {
    form.reset();
    await getItems();
  } else {
    alert('Create failed');
  }
}

async function deleteItem(id) {
  if (!confirm('Удалить товар?')) return;
  const res = await fetch(`/items/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (res.ok) {
    await getItems();
    await getCart();
  } else {
    alert('Delete failed');
  }
}

function editItem(id) {
  const title = prompt('New title?');
  const description = prompt('New description?');
  if (title === null && description === null) return;
  updateItem(id, { title, description });
}

async function updateItem(id, data) {
  const body = {};
  if (data.title) body.title = data.title;
  if (data.description) body.description = data.description;
  const res = await fetch(`/items/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    await getItems();
  } else {
    alert('Update failed');
  }
}

async function addToCart(itemId) {
  const res = await fetch('/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ item_id: itemId, quantity: 1 })
  });
  if (res.ok) {
    alert('Added to cart');
    await getCart();
  } else {
    alert('Add to cart failed');
  }
}

async function getCart() {
  const res = await fetch('/cart', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) return;
  const data = await res.json();
  const container = document.getElementById('cartItems');
  container.innerHTML = data.map(c => `
    <div class="cart-item">
      <h4>${c.title} (${c.quantity})</h4>
      <button onclick="removeFromCart(${c.item_id})">Remove</button>
    </div>
  `).join('');
}

async function removeFromCart(item_id) {
  if (!confirm('Удалить из корзины?')) return;
  const res = await fetch('/cart/remove', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ item_id })
  });
  if (res.ok) {
    alert('Removed from cart');
    await getCart();
  } else {
    alert('Remove failed');
  }
}

document.getElementById('createForm').addEventListener('submit', createItem);

window.addEventListener('load', async () => {
  await getItems();
  if (token) await getCart();
});
