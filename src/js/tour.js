// A short guided tour after the welcome sheet (spec 002 §13): one bubble at a time next to a
// highlighted element, no backdrop, skippable at any step.
import { t } from "./i18n.js";

const STEPS = [
  { target: "controls", text: "tour.moves" },
  { target: "btn-new", text: "tour.new" },
  { target: "btn-best", text: "tour.best" },
  { target: "btn-review", text: "tour.review" },
];
const GAP = 12;
const MARGIN = 8;

const visible = (el) => el && el.getClientRects().length > 0;

export function startTour() {
  // Hidden elements (layout, collapsed card) are left out rather than pointed at in the void
  const steps = STEPS.map((step) => ({ ...step, el: document.getElementById(step.target) })).filter((s) =>
    visible(s.el),
  );
  if (!steps.length) return;

  const bubble = document.createElement("div");
  bubble.className = "tour";
  bubble.setAttribute("role", "dialog");
  bubble.innerHTML = `<p></p><footer><span class="tour-count"></span>
    <button type="button" class="tour-skip"></button><button type="button" class="primary tour-next"></button></footer>`;
  document.body.append(bubble);
  let index = 0;

  const place = () => {
    const rect = steps[index].el.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = bubble;
    // Below the element when it fits, else above, else over its bottom edge (the board on a phone)
    let top = rect.bottom + GAP;
    if (top + height > innerHeight - MARGIN) top = rect.top - GAP - height;
    if (top < MARGIN) top = Math.min(rect.bottom, innerHeight) - height - MARGIN;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, MARGIN), innerWidth - width - MARGIN);
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const show = () => {
    for (const step of steps) step.el.classList.toggle("tour-target", step === steps[index]);
    bubble.querySelector("p").textContent = t(steps[index].text);
    bubble.querySelector(".tour-count").textContent = `${index + 1}/${steps.length}`;
    bubble.querySelector(".tour-skip").textContent = t("tour.skip");
    bubble.querySelector(".tour-next").textContent = t(index === steps.length - 1 ? "tour.done" : "tour.next");
    steps[index].el.scrollIntoView({ block: "nearest" });
    place();
    bubble.querySelector(".tour-next").focus({ preventScroll: true });
  };

  const end = () => {
    for (const step of steps) step.el.classList.remove("tour-target");
    bubble.remove();
    removeEventListener("resize", place);
    removeEventListener("scroll", place, true);
    removeEventListener("keydown", onKey, true);
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    end();
  };

  bubble.querySelector(".tour-skip").onclick = end;
  bubble.querySelector(".tour-next").onclick = () => (++index < steps.length ? show() : end());
  addEventListener("resize", place);
  addEventListener("scroll", place, true);
  addEventListener("keydown", onKey, true);
  show();
}
