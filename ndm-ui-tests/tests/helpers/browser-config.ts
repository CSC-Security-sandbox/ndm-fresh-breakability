import { BrowserContextOptions } from "@playwright/test";

/**
 * Standard browser context configuration optimized for 14-inch MacBook viewing
 * Uses a balanced viewport size - not too big, not too small
 */
export const getContextOptions = (): BrowserContextOptions => {
  return {
    // Use a balanced viewport size - good for 14-inch MacBook without being cramped
    viewport: { width: 1350, height: 825 },
    recordVideo: {
      dir: "./test-results/high-quality-videos/",
      // Balanced video size that's comfortable on 14-inch MacBook
      size: { width: 1350, height: 825 },
    },
    // Additional settings for better recording quality
    ignoreHTTPSErrors: true,
    // You can add other common options here like:
    // locale: 'en-US',
    // timezoneId: 'America/New_York',
  };
};

/**
 * Get context options without video recording for setup/navigation
 * Use this for initial setup that doesn't need recording
 */
export const getContextOptionsForSetup = (): BrowserContextOptions => {
  return {
    viewport: { width: 1350, height: 825 },
    ignoreHTTPSErrors: true,
  };
};

/**
 * Get context options that only record video on test failure
 * This helps avoid empty videos with 0 duration
 */
export const getContextOptionsWithVideoOnFailure =
  (): BrowserContextOptions => {
    return {
      viewport: { width: 1350, height: 825 },
      recordVideo: {
        dir: "./test-results/failure-videos/",
        size: { width: 1350, height: 825 },
      },
      ignoreHTTPSErrors: true,
    };
  };

/**
 * Get context options without video recording (for initial setup)
 */
export const getContextOptionsWithoutVideo = (): BrowserContextOptions => {
  return {
    viewport: { width: 1280, height: 720 },
    // No recordVideo property
  };
};

/**
 * Get context options with custom video directory (when needed)
 * Use this only when you need to override global video settings
 */
export const getContextOptionsWithVideoDir = (
  videoDir: string
): BrowserContextOptions => {
  return {
    ...getContextOptions(),
    recordVideo: {
      dir: videoDir,
      size: { width: 1920, height: 1080 }, // Full HD quality
    },
  };
};
