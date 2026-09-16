'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect mobile and tablet viewports and device types.
 * Supports SSR-safe hydration and live window resize tracking.
 */
export function useIsMobile(breakpoint: number = 768) {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isTablet, setIsTablet] = useState<boolean>(false);
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDevice = () => {
      const width = window.innerWidth;
      const isMobileWidth = width < breakpoint;
      const isTabletWidth = width >= breakpoint && width < 1024;
      const userAgentMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        );
      const hasTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

      setIsMobile(isMobileWidth || (userAgentMobile && width < 1024));
      setIsTablet(isTabletWidth);
      setIsTouchDevice(Boolean(hasTouch));
    };

    checkDevice();
    window.addEventListener('resize', checkDevice, { passive: true });
    return () => window.removeEventListener('resize', checkDevice);
  }, [breakpoint]);

  return { isMobile, isTablet, isTouchDevice };
}

export default useIsMobile;
