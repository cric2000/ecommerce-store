import { CheckoutAttempt, formatMoney, requestJSON, userMessage } from './client.js';

const $ = (selector) => document.querySelector(selector);
const checkout = new CheckoutAttempt();
const icons = ['notebook', 'pen', 'mug', 'backpack', 'lamp'];
let products = [];
let cart = null;
let order = null;
let coupon = null;
let report = null;
let busy = false;

function notice(message, error = false) {
  $('#notice-message').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').setAttribute('role', error ? 'alert' : 'status');
  $('#notice').setAttribute('aria-live', error ? 'assertive' : 'polite');
  $('#notice').hidden = !message;
}

$('#dismiss-notice').addEventListener('click', () => notice(''));

function text(selector, value, root = document) {
  root.querySelector(selector).textContent = value;
}

function listRow(left, right) {
  const row = document.createElement('li');
  const label = document.createElement('span');
  const value = document.createElement('strong');
  label.textContent = left;
  value.textContent = right;
  row.append(label, value);
  return row;
}

function render() {
  const locked = busy || checkout.pending !== null;
  const active = cart?.status === 'active';
  const cards = products.map((product, index) => {
    const card = $('#product-template').content.firstElementChild.cloneNode(true);
    text('h3', product.name, card);
    text('.product-price', formatMoney(product.unitPricePaise), card);
    text('.stock-pill', `${product.availableInventory} in stock`, card);
    card.querySelector('use').setAttribute('href', `#${icons[index] ?? 'notebook'}`);
    const button = card.querySelector('.add-product');
    button.dataset.productId = product.id;
    button.setAttribute('aria-label', `Add ${product.name} to cart`);
    button.disabled = locked || product.availableInventory === 0;
    return card;
  });
  $('#products').replaceChildren(...cards);
  text('#cart-count', cart?.items.length ?? 0);
  text('#cart-state', checkout.pending ? 'Confirm the checkout result before changing your cart.' : !cart ? 'A little room for good things.' : active ? 'Stock and prices are checked at checkout.' : 'Order placed. Start a new cart to keep browsing.');
  text('#cart-subtotal', formatMoney(cart?.subtotalPaise ?? 0));
  const lines = (cart?.items ?? []).map((item) => {
    const line = $('#cart-item-template').content.firstElementChild.cloneNode(true);
    line.dataset.productId = item.productId;
    text('.item-name', item.name, line);
    text('.item-price', `${formatMoney(item.unitPricePaise)} each`, line);
    text('.item-total', formatMoney(item.lineTotalPaise), line);
    const input = line.querySelector('.item-quantity');
    input.value = item.quantity;
    input.setAttribute('aria-label', `Quantity for ${item.name}`);
    input.disabled = locked || !active;
    for (const button of line.querySelectorAll('button')) button.disabled = locked || !active;
    line.querySelector('.availability').hidden = item.isAvailable || !active;
    return line;
  });
  $('#cart-items').replaceChildren(...lines);
  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = cart ? 'Your cart is empty. Find something you like.' : 'Choose an essential to get started.';
    $('#cart-items').append(empty);
  }
  $('#coupon-code').disabled = locked || !active;
  $('#checkout').disabled = busy || (!checkout.pending && (!active || !cart.items.length));
  text('#checkout', checkout.pending ? 'Retry checkout ↗' : busy ? 'Please wait…' : 'Place order ↗');
  for (const id of ['new-cart', 'generate-coupon', 'use-coupon']) $(`#${id}`).disabled = locked;
  for (const id of ['refresh', 'refresh-report']) $(`#${id}`).disabled = busy;

  $('#receipt').hidden = !order;
  if (order) {
    text('#order-id', `Order ${order.id} · ${new Date(order.createdAt).toLocaleString()}`);
    $('#order-items').replaceChildren(...order.items.map((item) => listRow(`${item.name} × ${item.quantity}`, formatMoney(item.lineTotalPaise))));
    text('#order-coupon', order.coupon ? `${order.coupon.discountPercent}% coupon applied · ${order.coupon.code}` : 'No coupon applied.');
    for (const field of ['subtotal', 'discount', 'total']) text(`#order-${field}`, formatMoney(order[`${field}Paise`]));
  }
  $('#generated-coupon').hidden = !coupon;
  if (coupon) {
    text('#coupon-description', `${coupon.discountPercent}% off · Earned after ${coupon.milestone} ${coupon.milestone === 1 ? 'order' : 'orders'} · ${coupon.status === 'redeemed' ? 'Already used' : 'Available'}`);
    text('#generated-code', coupon.code);
    $('#use-coupon').disabled = locked || coupon.status !== 'available';
    text('#use-coupon', coupon.status === 'redeemed' ? 'Already used' : 'Use in cart');
  }
  if (report) {
    text('#report-orders', report.totalOrders);
    text('#report-gross', formatMoney(report.grossRevenuePaise));
    text('#report-discounts', formatMoney(report.totalDiscountsPaise));
    text('#report-net', formatMoney(report.netRevenuePaise));
    text('#report-coupons', `Coupons: ${report.coupons.generated} generated · ${report.coupons.available} available · ${report.coupons.redeemed} redeemed`);
    $('#report-quantities').replaceChildren(...report.purchasedQuantityByProduct.map((item) => {
      const name = products.find((product) => product.id === item.productId)?.name ?? 'Product no longer available';
      return listRow(name, item.quantity);
    }));
    if (!report.purchasedQuantityByProduct.length) $('#report-quantities').append(listRow('No purchases yet', '—'));
  }
}

async function run(action) {
  if (busy) return;
  busy = true;
  render();
  notice('');
  try {
    await action();
  } catch (error) {
    const message = userMessage(error);
    notice(checkout.pending ? `${message} Retry checkout to recover the original order; keep this page open.` : message, true);
  } finally {
    busy = false;
    render();
  }
}

async function refreshStore() {
  products = (await requestJSON('/products')).products;
  report = await requestJSON('/admin/report');
  if (cart) {
    cart = await requestJSON(`/carts/${encodeURIComponent(cart.id)}`);
  }
  const orderId = cart?.orderId ?? order?.id;
  if (orderId) order = await requestJSON(`/orders/${encodeURIComponent(orderId)}`);
}

async function newCart() {
  cart = await requestJSON('/carts', { method: 'POST', body: {} });
  $('#coupon-code').value = '';
}

$('#products').addEventListener('click', (event) => {
  const button = event.target.closest('.add-product');
  if (!button || checkout.pending) return;
  run(async () => {
    if (cart?.status !== 'active') await newCart();
    cart = await requestJSON(`/carts/${encodeURIComponent(cart.id)}/items`, {
      method: 'POST', body: { productId: button.dataset.productId, quantity: 1 },
    });
    notice('Added to your cart.');
  });
});

$('#cart-items').addEventListener('submit', (event) => {
  event.preventDefault();
  if (checkout.pending) return;
  const form = event.target;
  const quantity = Number(form.querySelector('.item-quantity').value);
  run(async () => {
    cart = await requestJSON(`/carts/${encodeURIComponent(cart.id)}/items/${encodeURIComponent(form.dataset.productId)}`, { method: 'PATCH', body: { quantity } });
    notice('Cart updated.');
  });
});

$('#cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-item');
  if (!button || checkout.pending) return;
  const productId = button.closest('form').dataset.productId;
  run(async () => {
    cart = await requestJSON(`/carts/${encodeURIComponent(cart.id)}/items/${encodeURIComponent(productId)}`, { method: 'DELETE' });
    notice('Item removed.');
  });
});

$('#checkout-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!checkout.pending && (!cart?.items.length || cart.status !== 'active')) return;
  const code = $('#coupon-code').value;
  run(async () => {
    order = await checkout.submit(cart.id, code);
    if (coupon && coupon.code === order.coupon?.code) coupon = { ...coupon, status: 'redeemed' };
    cart = null;
    $('#coupon-code').value = '';
    render();
    notice('Order placed. Your receipt is below the collection.');
    try {
      await refreshStore();
    } catch {
      notice('Your order is placed. Refresh the store to update stock and the report.', true);
    }
    render();
    $('#receipt').scrollIntoView({ block: 'nearest' });
  });
});

$('#new-cart').addEventListener('click', () => {
  if (!checkout.pending) run(async () => { await newCart(); notice('New cart ready.'); });
});
$('#refresh').addEventListener('click', () => run(refreshStore));
$('#refresh-report').addEventListener('click', () => run(async () => { report = await requestJSON('/admin/report'); }));
$('#generate-coupon').addEventListener('click', () => run(async () => {
  coupon = await requestJSON('/admin/coupons', { method: 'POST', body: {} });
  report = await requestJSON('/admin/report');
  notice('Your coupon is ready. Use it in your cart or copy the code.');
}));
$('#use-coupon').addEventListener('click', () => {
  if (!checkout.pending && coupon?.status === 'available') {
    run(async () => {
      if (cart?.status !== 'active') await newCart();
      $('#coupon-code').value = coupon.code;
      notice(cart.items.length ? 'Coupon added. The discount will appear in your order.' : 'Coupon added to your new cart. Choose some items, then place your order.');
      $('.cart-panel').scrollIntoView({ block: 'start' });
    });
  }
});
$('#copy-coupon').addEventListener('click', async () => {
  if (!coupon) return;
  notice('');
  try {
    await navigator.clipboard.writeText(coupon.code);
    notice('Coupon code copied.');
  } catch {
    notice('Copy didn’t work. Select the code and copy it manually.', true);
  }
});

run(refreshStore);
