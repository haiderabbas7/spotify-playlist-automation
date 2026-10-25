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
     * Reads lowdb.json again on every access, so the current state is always used
     */
    private async getDB() {
        const db = await JSONFilePreset<Data>('lowdb.json', { playlists: [] });
        await db.read();
        return db;
    }

    /**
     * true if the playlist was shuffled before and is therefore in the lowdb
     */
    async doesPlaylistExist(playlist_id: string): Promise<boolean> {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);
        return !!playlist;
    }

    /**
     * Creates an empty entry for a playlist
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
     * snapshot_id of the playlist after the last shuffle
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
     * Saves the snapshot_id after a shuffle, later changes to the playlist are detected with it
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
     * Adds a song with its start weight to the weights of a playlist
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
     * Sets the weight of a song in a playlist
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
     * All songs of a playlist with their weight
     */
    async getTracks(playlist_id: string) {
        const db = await this.getDB();
        const playlist = db.data.playlists.find((playlist) => playlist.playlist_id === playlist_id);

        if (!playlist) {
            throw new Error(`Playlist mit der ID ${playlist_id} wurde nicht gefunden.`);
        }

        return playlist.tracks || [];
    }

    //works, even though it looks like call by value
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

        // remove the track from the playlist
        playlist.tracks.splice(trackIndex, 1);
        await db.write();
    }

    /**
     * The songs that were moved to the top in the last shuffle
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
     * Clears the list of last shuffled songs, happens before every new shuffle
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
     * Remembers a song as "at the top in the last shuffle", for the weighting next time
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
