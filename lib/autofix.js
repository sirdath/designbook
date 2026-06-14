/* ============================================
   designbook · lib/autofix.js — deterministic self-heal
   ============================================
   Repairs the known-safe failure classes on composed HTML BEFORE it is scored
   or shown, so the agent never inherits a self-inflicted blank draft. Pure and
   idempotent — returns { html, fixed:[] }. Only touches things that are
   unambiguously safe to repair; anything judgement-y is left for the agent.
   ============================================ */

// The same guarded reveal observer renderComposedHtml emits — used as a safety
// net for any .s-reveal markup that arrives WITHOUT a reveal mechanism (older
// drafts, hand-authored HTML). Without it, .s-reveal stays opacity:0 forever.
const REVEAL_SCRIPT =
  '<script>/* db-autofix reveal */(function(){var els=document.querySelectorAll(".s-reveal");if(!els.length)return;' +
  'var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;' +
  'if(reduce||!("IntersectionObserver" in window)){for(var i=0;i<els.length;i++)els[i].classList.add("is-in");return;}' +
  'var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("is-in");io.unobserve(e.target);}});},{rootMargin:"0px 0px -8% 0px",threshold:0.04});' +
  'for(var j=0;j<els.length;j++)io.observe(els[j]);' +
  'requestAnimationFrame(function(){for(var k=0;k<els.length;k++){if(els[k].getBoundingClientRect().top<window.innerHeight)els[k].classList.add("is-in");}});})();</script>';

export function autofix(html) {
  let h = String(html || '');
  const fixed = [];

  // 1. .s-reveal present but nothing reveals it → inject the guarded observer.
  if (/class="[^"]*\bs-reveal\b/.test(h) && !/IntersectionObserver/.test(h)) {
    h = h.includes('</body>') ? h.replace('</body>', REVEAL_SCRIPT + '\n</body>') : h + REVEAL_SCRIPT;
    fixed.push('injected reveal-on-scroll observer — .s-reveal content would have rendered blank');
  }

  // 2. real <img> with no alt → add alt="" + a data-todo-alt marker so it is
  //    accessible now and findable for a real alt later. (mediaBox <div>s aren't
  //    <img>, so decorative placeholders are untouched.)
  let imgFixes = 0;
  h = h.replace(/<img\b(?![^>]*\balt=)[^>]*>/gi, (tag) => {
    imgFixes++;
    return tag.replace(/<img\b/i, '<img alt="" data-todo-alt');
  });
  if (imgFixes) fixed.push(`added alt="" to ${imgFixes} <img> missing it — set a descriptive alt (data-todo-alt marks them)`);

  return { html: h, fixed };
}
