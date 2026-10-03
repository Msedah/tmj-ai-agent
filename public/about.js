const backLink = document.querySelector("[data-about-back]");

backLink?.addEventListener("click", event => {
  try {
    const referrer = new URL(document.referrer);
    const cameFromChat = referrer.origin === window.location.origin && ["/", "/index.html"].includes(referrer.pathname);
    if (cameFromChat && window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  } catch {
    // Keep the link's href="/" fallback when there is no usable same-site referrer.
  }
});
