try {
  var s = localStorage.getItem("theme");
  document.documentElement.dataset.theme = s === "dark" ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
