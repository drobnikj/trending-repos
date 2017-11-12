const server = require('server');
const { get, post } = server.router;
const { render, json, type } = server.reply;
const ApifyClient = require('apify-client');
const MongoClient = require('mongodb').MongoClient;

const TRENDING_LANGUAGES = ['unknown', 'javascript', 'makefile', 'python', 'ruby'];
const GITHUB_PAGES = TRENDING_LANGUAGES.map(language => {
    return {
        url: `https://github.com/trending/${language}?since=daily`,
        language
    };
});

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
    if (language === 'javascript') {
        const todayCollection = db.collection('trendingToday');
        const repos = await todayCollection.find({ language }).toArray();
        return type('xml').render('xml_feed.hbs', { repos });
    }
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
        const todayCollection = db.collection('trendingToday');
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
};

// Connect to MongoDB and start server
MongoClient.connect(process.env.MONGO_URL, (err, database) => {
    if (err) {
        console.log('Unable to connect to MongoDB.');
        console.error(err);
        process.exit(1)
    } else {
        db = database;
        server(getHomePage, getRssFeed).then(ctx => {
            console.log(`Server launched on http://localhost:${ctx.options.port}/`);
        });
        setInterval(getGitHubReposToday, 60*60*1000);
    }
});