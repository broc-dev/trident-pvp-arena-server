import Arena from "@colyseus/arena";
import { monitor } from "@colyseus/monitor";

/**
 * Import your Room files
 */
import { ArenaRoom } from "./rooms/ArenaRoom";
import { LobbyRoom } from "./rooms/LobbyRoom";
import { CurrentGameChatRoom } from "./rooms/CurrentGameChatRoom";
import { GlobalChatRoom } from "./rooms/GlobalChatRoom";

export default Arena({
    getId: () => "Trident PVP Server",

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        // Game Room Types
        gameServer.define('arena_room', ArenaRoom);

        // Chat Room Types
        gameServer.define('global_chat', GlobalChatRoom);
        gameServer.define('current_room', CurrentGameChatRoom);
        

        // Lobby Room
        gameServer.define('lobby_room', LobbyRoom);

        // gameServer.simulateLatency(250); // Uncomment to debug latency
    },

    initializeExpress: (app) => {
        /**
         * Bind your custom express routes here:
         */
        app.get("/", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Bind @colyseus/monitor
         * It is recommended to protect this route with a password.
         * Read more: https://docs.colyseus.io/tools/monitor/
         */
        app.use("/colyseus", monitor());
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});