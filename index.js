const server = require('server');
const { get } = server.router;
const { render, type } = server.reply;
const ApifyClient = require('apify-client');
const MongoClient = require('mongodb').MongoClient;
const moment = require('moment');

const TRENDING_LANGUAGES = ['unknown', 'javascript', 'python', 'ruby'];
const GITHUB_PAGES = TRENDING_LANGUAGES.map(language => {
    return {
        url: `https://github.com/trending/${language}?since=daily`,
        language
    };
});

const todayCollectionName = 'trendingToday';

const apifyClient = new ApifyClient({
    userId: process.env.USER_ID,
    token: process.env.TOKEN,
});

let db;

const getHomePage = get('/', () => {
    return render('index.hbs', { languages: GITHUB_PAGES });
});
const getRssFeed = get('/rss/:language', async ctx => {
    const language = ctx.params.language;
    const todayCollection = db.collection(todayCollectionName);
    const repos = await todayCollection.find({ language }).limit(50).sort({ createdAt: -1 }).toArray();
    repos.map((repo) => {
       repo.createdAt = moment(repo.createdAt).format('ddd, DD MMM YYYY HH:mm:ss ZZ');
    });
    return type('xml').render('xml_feed.hbs', { repos, language });
});

const getGitHubReposToday = async () => {
    console.log('Getting trending repos from github page ...');
    const actRun = await apifyClient.acts.runAct({
        actId: 'drobnikj/github-trendings',
        body: JSON.stringify(GITHUB_PAGES),
        contentType: 'application/json',
        waitForFinish: 999999
    });
    if (actRun.status === 'SUCCEEDED') {
        const resultsRecord = await apifyClient.keyValueStores.getRecord({
            storeId: actRun.defaultKeyValueStoreId,
            key: 'OUTPUT',
        });
        const todayCollection = db.collection(todayCollectionName);
        for (let result of resultsRecord.body) {
            const language =  result.language;
            for (let repo of result.reposList) {
                repo.createdAt = new Date();
                repo.language = language;
                const repoInCollection = await todayCollection.findOne({ name: repo.name });
                if (!repoInCollection) await todayCollection.insert(repo);
            }
        }
    } else {
        console.log('Act Fail!!');
    }
    console.log('GitHub repos updated.')
};

// Connect to MongoDB and start server
MongoClient.connect(process.env.MONGO_URL, (err, database) => {
    if (err) {
        console.log('Unable to connect to MongoDB.');
        console.error(err);
        process.exit(1)
    } else {
        db = database;
        db.collection(todayCollectionName).ensureIndex({ language:1 , createdAt: -1 });
        server(getHomePage, getRssFeed).then(ctx => {
            console.log(`Server launched on http://localhost:${ctx.options.port}/`);
        });
        // Set automatic repos update
        //setInterval(getGitHubReposToday, 60*60*1000);
    }
});