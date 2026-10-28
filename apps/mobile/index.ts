import { registerRootComponent } from "expo";
import App from "./App";
import { startCarPlay } from "./src/carplay";

registerRootComponent(App);
// Listen for a CarPlay connection from the start (the car can connect before any screen opens).
startCarPlay();
