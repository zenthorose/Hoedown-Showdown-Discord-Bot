class ReactionPostsManager {
    constructor() {
        this.reactionPosts = [];
    }
    

    addPost(post) {
        this.reactionPosts.push(post);
    }

    findPostByMessageId(messageId) {
        return this.reactionPosts.find(post => post.messageId === messageId);
    }

    getAllPosts() {
        return this.reactionPosts;
    }
}

module.exports = ReactionPostsManager;