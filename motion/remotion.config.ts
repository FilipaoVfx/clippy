import {Config} from '@remotion/cli/config';

// The VPS has 2 CPUs and ~8 GB RAM with swap usually full: keep renders lean.
Config.setConcurrency(2);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
