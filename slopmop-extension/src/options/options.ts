import { getSettings } from "../shared/settings";
import { mountDevPanel } from "./devPanel";

/** The extension's settings page: developer options (debug mode, saved votes). */
void getSettings().then(mountDevPanel);
