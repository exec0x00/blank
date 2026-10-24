import { useEffect, type RefObject } from 'react';

/**
 * A slim overlay scrollbar shared by every scroll area in the composer: the native
 * bar is hidden, a thumb appears on hover or scroll, and the edges fade while
 * there is more to see. The thumb can be dragged and the track clicked.
 */
export function useCustomScroll(ref: RefObject<HTMLElement | null>, { right = 4, inset = 4 } = {}, deps: unknown[] = []) {
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = 'qc-sbar'; bar.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'qc-sbar-t'; bar.appendChild(thumb);
    el.after(bar); el.classList.add('qc-cs');
    let thumbHeight = 0, idle = 0, frame = 0, dragY = 0, dragTop = 0;
    const overflowing = () => el.scrollHeight > el.clientHeight + 1 && el.offsetParent !== null;
    const paint = () => {
      frame = 0;
      const on = overflowing();
      bar.classList.toggle('on', on);
      el.classList.toggle('fade-t', on && el.scrollTop > 2);
      el.classList.toggle('fade-b', on && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
      if (!on) return;
      const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const height = el.clientHeight, full = el.scrollHeight, track = height - paddingTop - inset * 2;
      bar.style.top = `${el.offsetTop + paddingTop + inset}px`; bar.style.height = `${track}px`;
      bar.style.left = `${el.offsetLeft + el.offsetWidth - 8 - right}px`;
      thumbHeight = Math.max(28, track * height / full);
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${(track - thumbHeight) * (el.scrollTop / (full - height || 1))}px)`;
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const flash = () => {
      bar.classList.add('active'); clearTimeout(idle);
      idle = window.setTimeout(() => { if (!bar.classList.contains('drag')) bar.classList.remove('active'); }, 900);
    };
    const onScroll = () => { request(); flash(); };
    const enter = () => bar.classList.add('hover'), leave = () => bar.classList.remove('hover');
    const down = (event: PointerEvent) => {
      event.preventDefault(); event.stopPropagation(); thumb.setPointerCapture(event.pointerId);
      bar.classList.add('drag', 'active'); dragY = event.clientY; dragTop = el.scrollTop;
    };
    const move = (event: PointerEvent) => {
      if (!bar.classList.contains('drag')) return;
      el.scrollTop = dragTop + (event.clientY - dragY) * ((el.scrollHeight - el.clientHeight) / ((bar.clientHeight - thumbHeight) || 1));
    };
    const end = () => { bar.classList.remove('drag'); flash(); };
    const page = (event: PointerEvent) => {
      if (event.target !== bar) return;
      event.stopPropagation();
      const rect = thumb.getBoundingClientRect();
      el.scrollBy({ top: (event.clientY < rect.top ? -1 : 1) * el.clientHeight * .9, behavior: 'smooth' });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    for (const node of [el, bar]) { node.addEventListener('pointerenter', enter); node.addEventListener('pointerleave', leave); }
    thumb.addEventListener('pointerdown', down); thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    bar.addEventListener('pointerdown', page);
    const resize = new ResizeObserver(request); resize.observe(el);
    const mutation = new MutationObserver(request); mutation.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', request);
    request();
    return () => {
      cancelAnimationFrame(frame); clearTimeout(idle);
      el.removeEventListener('scroll', onScroll);
      for (const node of [el, bar]) { node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave); }
      resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', request);
      el.classList.remove('qc-cs', 'fade-t', 'fade-b'); bar.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, right, inset, ...deps]);
}
