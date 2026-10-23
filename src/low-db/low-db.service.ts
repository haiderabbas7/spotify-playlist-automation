import { Injectable } from '@nestjs/common';
import { JSONFilePreset } from 'lowdb/node';

type Track = {
    uri: string;
    weight: number;
};

type Playlist = {
    playlist_id: string;
    snapshot_id: string;
    last_shuffled_tracks: Track[];
    tracks: Track[];
};

type Data = {
    playlists: Playlist[];
};

@Injectable()
export class LowDbService {
    /**
     * Liest lowdb.json bei jedem Zugriff neu ein, damit immer der aktuelle Stand benutzt wird
     */
    private async getDB() {
        const db = await JSONFilePreset<Data>('lowdb.json', { playlists: [] });
        await db.read();
        return db;
    }

    /**
     * true, wenn die Playlist schon mal geshuffled wurde und deshalb in der lowdb steht
     */
    async doesPlaylistExist(playlist_id: string): Promise<boolean> {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);
        return !!playlist;
    }

    /**
     * Legt einen leeren Eintrag für eine Playlist an
     */
    async addPlaylist(playlist_id: string) {
        const db = await this.getDB();
        const playlist: Playlist = {
            playlist_id: playlist_id,
            snapshot_id: '',
            last_shuffled_tracks: [],
            tracks: [],
        };
        db.data.playlists.push(playlist);
        await db.write();
    }

    /**
     * snapshot_id der Playlist nach dem letzten Shuffle
     */
    async getSnapshotID(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        return playlist.snapshot_id;
    }

    /**
     * Speichert die snapshot_id nach einem Shuffle, darüber werden später Änderungen an der Playlist erkannt
     */
    async setSnapshotID(playlist_id: string, snapshot_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);
        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.snapshot_id = snapshot_id;
        await db.write();
    }

    /**
     * Fügt einen Song mit Startgewicht zu den Gewichten einer Playlist hinzu
     */
    async addTrack(playlist_id: string, uri: string, weight: number) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.tracks.push({ uri: uri, weight: weight });
        await db.write();
    }

    /**
     * Setzt das Gewicht eines Songs in einer Playlist
     */
    async updateWeight(playlist_id: string, uri: string, weight: number) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} nicht gefunden.`);
        }

        const track = playlist.tracks.find((track) => track.uri === uri);

        if (!track) {
            throw new Error(`Track mit der URI ${uri} nicht gefunden.`);
        }

        track.weight = weight;
        await db.write();
    }

    /**
     * Alle Songs einer Playlist mit ihrem Gewicht
     */
    async getTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }

        return playlist.tracks || [];
    }

    //FUNKTIONIERT, AUCH WENN ES NACH CALL BY VALUE AUSSIEHT
    async removeTrack(playlist_id: string, uri: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }

        const trackIndex = playlist.tracks.findIndex((track) => track.uri === uri);

        if (trackIndex === -1) {
            throw new Error(`Track mit der URI ${uri} wurde nicht gefunden.`);
        }

        // Entferne den Track aus der Playlist
        playlist.tracks.splice(trackIndex, 1);
        await db.write();
    }

    /**
     * Die Songs, die beim letzten Shuffle nach vorne gekommen sind
     */
    async getLastShuffledTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }

        return playlist.last_shuffled_tracks || [];
    }

    /**
     * Leert die Liste der zuletzt geshuffelten Songs, passiert vor jedem neuen Shuffle
     */
    async clearLastShuffledTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.last_shuffled_tracks = [];
        await db.write();
    }

    /**
     * Merkt sich einen Song als "beim letzten Shuffle vorne", für die Gewichtung beim nächsten Mal
     */
    async addShuffledTrack(playlist_id: string, uri: string, weight: number) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.last_shuffled_tracks.push({ uri: uri, weight: weight });
        await db.write();
    }
}
