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
    private async getDB() {
        const db = await JSONFilePreset<Data>('lowdb.json', { playlists: [] });
        await db.read();
        return db;
    }

    async doesPlaylistExist(playlist_id: string): Promise<boolean> {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);
        return !!playlist;
    }

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

    async getSnapshotID(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        return playlist.snapshot_id;
    }

    async setSnapshotID(playlist_id: string, snapshot_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);
        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.snapshot_id = snapshot_id;
        await db.write();
    }

    async addTrack(playlist_id: string, uri: string, weight: number) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.tracks.push({ uri: uri, weight: weight });
        await db.write();
    }

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

    async getLastShuffledTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }

        return playlist.last_shuffled_tracks || [];
    }

    async clearLastShuffledTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }
        playlist.last_shuffled_tracks = [];
        await db.write();
    }

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
