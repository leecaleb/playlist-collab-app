const express = require('express')
const path = require('path')
const app = express()
const bodyParser = require('body-parser')
// var querystring = require('querystring')
const cookieParser = require('cookie-parser')
// var validate = require('express-jsonschema').validate
const passport = require('passport')
const axios = require('axios')
require('dotenv').config()
require('./socket')

var env = process.env.NODE_ENV || 'development'
const SERVER_HOST = (env === 'development') ? 'http://localhost:5000' : process.env.SERVER_HOST
const WEB_URL = (env === 'development') ? 'http://localhost:3000' : process.env.WEB_URL

var MongoClient = require('mongodb').MongoClient
var ObjectID = require('mongodb').ObjectID
var DBurl = process.env.MONGO_URL

MongoClient.connect(DBurl, function (err, db) {

	if (err) {
		console.log('error occured when connecting to the database: ', err)
	}

	app.use(cookieParser())

	app.use((req, res, next) => {
		// console.log(req.headers)
		// if (req.headers.referer.endsWith('localhost:3000/')) {
		res.setHeader('Access-Control-Allow-Origin', WEB_URL)
		res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization')
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
		// }
		next()
	})

	// Priority serve any static files.
	// app.use(express.static(path.resolve(__dirname, '../react-ui/build')))
	app.use(passport.initialize())
	app.use(passport.session())

	const PORT = process.env.PORT || 5000
	app.listen(PORT, function () {
		console.log(`Listening on port ${PORT}`)
	})

	const client_id = process.env.CLIENT_ID
	const client_secret = process.env.CLIENT_SECRET
	var redirect_uri = SERVER_HOST + '/callback' // Your redirect uri

	var SpotifyWebApi = require('spotify-web-api-node')

	var spotifyApi = new SpotifyWebApi({
		clientId: client_id,
		clientSecret: client_secret,
		redirectUri: redirect_uri
	})


	const SpotifyStrategy = require('passport-spotify').Strategy

	passport.serializeUser(function (user, done) {
		done(null, user)
	})

	passport.deserializeUser(function (obj, done) {
		done(null, obj)
	})

	passport.use(new SpotifyStrategy({
		clientID: client_id,
		clientSecret: client_secret,
		callbackURL: redirect_uri
	}, (accessToken, refreshToken, profile, done) => {
		process.nextTick(function () {
			return done(null, profile)
		})
	}))

	app.use(bodyParser.text())
	app.use(bodyParser.json())

	app.get('/auth/spotify', passport.authenticate(
		'spotify',
		{ scope: ['user-read-private', 'user-read-email'], showDialog: true }
	), (req, res) => { }
	)

	app.get('/callback', function (req, res) {
		// your application requests refresh and access tokens
		// after checking the state parameter
		var code = req.query.code || null
		spotifyApi.authorizationCodeGrant(code)
			.then(function (data) {
				// Set the access token on the API object to use it in later calls
				spotifyApi.setAccessToken(data.body['access_token'])
				spotifyApi.setRefreshToken(data.body['refresh_token'])
				// res.cookie('refresh_token', spotifyApi.refresh)
				spotifyApi.getMe()
					.then(function (data) {
						db.collection('users').findOne({
							fullName: data.body.id
						}, (err, userData) => {
							if (err) {
								console.log(err)
							} else if (userData === null) {
								db.collection('users').insertOne({
									_id: new ObjectID(),
									fullName: data.body.id,
									img: '',
									feed: {},
									groups: [],
									likedPlaylist: []
								}, (err, new_user) => {
									if (err) {
										console.log(err)
									} else {
										// res.cookie('token', new Buffer(JSON.stringify({ id: new_user.insertedId })).toString('base64'))
										res.redirect(WEB_URL + '/user/' + new_user.insertedId)
									}
								})
							} else {
								var token = new Buffer(JSON.stringify({ id: userData._id })).toString('base64')
								res.cookie('token', token)
								res.redirect(WEB_URL + '/user/' + userData._id)
							}
						})
					}, function (err) {
						console.log('Something went wrong!', err)
					})
			}, function (err) {
				console.log('Something went wrong!', err)
				res.status(401).end()
			})
	})

	function resolveUserObjects(userList, callback) {
		if (userList.length === 0) {
			callback(null, {})
		} else {
			var query = {
				$or: userList.map((id) => { return { _id: id } })
			}
			db.collection('users').find(query).toArray(function (err, users) {
				if (err) {
					return callback(err)
				}
				var userMap = {}
				users.forEach((user) => {
					userMap[user._id] = user
				})
				callback(null, userMap)
			})
		}
	}

	//getUserData
	app.get('/user/:userid', (req, res) => {
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			db.collection('users').findOne({
				_id: new ObjectID(user_id)
			}, (err, userData) => {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (userData === null) {
					res.status(400).send('User with id: ' + user_id + 'does not exist')
				} else {
					res.status(200).send(userData)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	function getFeedItem(feedItemId, callback) {
		db.collection('feedItems').findOne({
			_id: feedItemId
		}, function (err, feedItem) {
			if (err) {
				return callback(err)
			} else if (feedItem === null) {
				return callback(null, null)
			}
			var userList = [feedItem.author]
			userList = userList.concat(feedItem.likerList)
			userList = userList.concat(feedItem.groupUsers)
			resolveUserObjects(userList, function (err, userMap) {
				if (err) {
					return callback(err)
				}
				feedItem.author = userMap[feedItem.author]
				feedItem.likerList = feedItem.likerList.map((userId) => userMap[userId])
				feedItem.groupUsers = feedItem.groupUsers.map((userId) => userMap[userId])
				callback(null, feedItem)
			})
		})
	}

	function getFeedData(user, callback) {
		// console.log('getFeedData user: ' + user)
		db.collection('users').findOne({
			_id: user
		}, function (err, userData) {
			if (err) {
				return callback(err)
			} else if (userData === null) {
				return callback(null, null)
			}
			db.collection('feeds').findOne({
				_id: userData.feed
			}, function (err, feedData) {
				if (err) {
					return callback(err)
				} else if (feedData === null) {
					return callback(null, [])
				}
				var resolvedContents = []

				function processNextFeedItem(i) {
					getFeedItem(feedData.contents[i], function (err, feedItem) {
						if (err) {
							callback(err)
						} else {
							resolvedContents.push(feedItem)
							if (resolvedContents.length === feedData.contents.length) {
								feedData.contents = resolvedContents
								callback(null, feedData)
							} else {
								processNextFeedItem(i + 1)
							}
						}
					})
				}

				if (feedData.contents.length === 0) {
					// console.log('feedData.contents.length: ' + feedData.contents.length)
					callback(null, feedData)
				} else {
					processNextFeedItem(0)
				}
			})
		})
	}

	//getFeedData
	app.get('/user/:userid/feed', function (req, res) {
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			getFeedData(new ObjectID(user_id), function (err, feedData) {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (feedData === null) {
					res.status(400).send('Could not look up feed for user ' + user_id)
				} else {
					res.send(feedData)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	function getLikedPlaylist(user, callback) {
		db.collection('users').findOne({
			_id: user
		}, function (err, userData) {
			var resolvedLikedPlaylist = []

			function processNextFeedItem(i) {
				getFeedItem(userData.likedPlaylist[i], function (err, feeditem) {
					if (err) {
						callback(err)
					} else {
						resolvedLikedPlaylist.push(feeditem)
						if (resolvedLikedPlaylist.length === userData.likedPlaylist.length) {
							userData.likedPlaylist = resolvedLikedPlaylist
							callback(err, userData.likedPlaylist)
						} else {
							processNextFeedItem(i + 1)
						}
					}
				})
			}

			if (userData.likedPlaylist.length === 0) {
				callback(null, [])
			} else {
				processNextFeedItem(0)
			}
		})
	}

	// getLikedPlaylist
	app.get('/user/:userid/likedplaylist', function (req, res) {
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			getLikedPlaylist(new ObjectID(user_id), function (err, playlist) {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (playlist === null) {
					res.status(400).send('Could not look up playlist for user ' + user_id)
				} else {
					res.send(playlist)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	function getGroupHistory(user, callback) {
		db.collection('users').findOne({
			_id: user
		}, function (err, userData) {
			if (err) throw err

			var resolvedGroup = []

			function processNextFeedItem(i) {
				getFeedItem(userData.groups[i], function (err, groups) {
					if (err) {
						callback(err)
					} else {
						resolvedGroup.push(groups)
						if (userData.groups.length === resolvedGroup.length) {
							userData.groups = resolvedGroup
							callback(null, userData.groups)
						} else {
							processNextFeedItem(i + 1)
						}
					}
				})
			}

			if (userData.groups.length === 0) {
				callback(null, [])
			} else {
				processNextFeedItem(0)
			}
		})
	}

	// getGroupHistory
	app.get('/user/:userid/history', function (req, res) {
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			getGroupHistory(new ObjectID(user_id), function (err, group) {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (group === null) {
					res.status(400).send('Could not look up group histry list for user ' + user_id)
				} else {
					res.send(group)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	// getGroupData
	app.get('/feeditem/:feeditemid', function (req, res) {
		var feeditem_id = req.params.feeditemid
		getFeedItem(new ObjectID(feeditem_id), function (err, feeditem) {
			if (err) {
				res.status(500).send('Database error: ' + err)
			} else if (feeditem === null) {
				res.status(400).send('Could not look up feeditem' + feeditem_id)
			} else {
				res.send(feeditem)
			}
		})
	})

	
	function likeFeedItem(feedItemId, userId, cb) {
		db.collection('users').updateOne({
			_id: userId
		}, {
			$addToSet: { likedPlaylist: feedItemId }
		})

		db.collection('feedItems').findOneAndUpdate({
			_id: feedItemId
		}, {
			$addToSet: { likerList: userId }
		}, {
			returnOriginal: false
		}, (err, feedItemData) => {
			if (err) throw err

			var updatedLikeCounter = feedItemData.value.likerList

			resolveUserObjects(updatedLikeCounter, function (err, userMap) {
				if (err) {
					cb(err)
				}
				updatedLikeCounter = updatedLikeCounter.map((userId) => userMap[userId])
				cb(null, updatedLikeCounter)
			})
		})
	}

	// likeFeedItem
	app.put('/feeditem/:feeditemid/likerlist/:userid', function (req, res) {
		var feeditem_id = req.params.feeditemid
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			likeFeedItem(new ObjectID(feeditem_id), new ObjectID(user_id), (err, updatedLikeCounter) => {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (updatedLikeCounter === null) {
					res.status(400).send('Could not look up feeditem' + feeditem_id)
				} else {
					res.send(updatedLikeCounter)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	function unlikeFeedItem(feedItemId, userId, cb) {
		db.collection('users').updateOne({
			_id: userId
		}, {
			$pull: { likedPlaylist: feedItemId }
		})

		db.collection('feedItems').findOneAndUpdate({
			_id: feedItemId
		}, {
			$pull: { likerList: userId }
		}, {
			returnOriginal: false
		}, (err, feedItemData) => {
			if (err) throw err

			var updatedLikeCounter = feedItemData.value.likerList
			resolveUserObjects(updatedLikeCounter, (err, userMap) => {
				if (err) {
					cb(err)
				}
				updatedLikeCounter = updatedLikeCounter.map((userId) => userMap[userId])
				cb(null, updatedLikeCounter)
			})
		})
	}

	// unlikeFeedItem
	app.delete('/feeditem/:feeditemid/likerlist/:userid', function (req, res) {
		var feedItem_id = req.params.feeditemid
		var user_id = req.params.userid
		var fromUser = getUserIdFromToken(req.get('Authorization'))
		if (fromUser === user_id) {
			unlikeFeedItem(new ObjectID(feedItem_id), new ObjectID(user_id), (err, updatedLikeCounter) => {
				if (err) {
					res.status(500).send('Database error: ' + err)
				} else if (updatedLikeCounter === null) {
					res.status(400).send('Could not look up feedItem: ' + feedItem_id)
				} else {
					res.send(updatedLikeCounter)
				}
			})
		} else {
			res.status(401).send('UNAUTHORIZED: Access denied')
		}
	})

	//searchSong - spotify
	app.post('/search', function (req, res) {
		if (typeof (req.body) === 'string') {
			var queryText = req.body.trim().toLowerCase()
			spotifyApi.searchTracks(queryText, { limit: 10 })
				.then(function (data) {
					res.send(data.body)
				}, function (err) {
					spotifyApi.refreshAccessToken().then((data) => {
						console.log('access token refreshed!')
						spotifyApi.setAccessToken(data.body['access_token'])
						spotifyApi.searchTracks(queryText, { limit: 10 })
							.then((data) => {
								res.send(data.body)
							}, (err) => {
								console.log(err)
								res.status(400).end()
							})
					}, (err) => {
						console.log('could not refresh access token', err)
					})
				})
		}
	})

	var google = require('googleapis')

	//searchYoutube
	app.post('/search/youtube', function (req, res) {
		if (typeof (req.body) === 'string') {
			var queryText = req.body.trim().toLowerCase()
			var service = google.youtube('v3')
			service.search.list({
				maxResults: 10,
				q: queryText,
				part: 'snippet',
				type: 'video',
				key: process.env.YOUTUBE_API_KEY
			}, function (err, data) {
				if (err) {
					console.log('The API returned an error: ' + err)
					return
				}
				res.send(data.items)
			})
		}
	})

	// addSong:Spotify returns a list of track objects
	function addSong(feedItemId, songId, cb) {
		db.collection('feedItems').findOne({
			_id: feedItemId
		}, (err, feedItemData) => {
			if (err) throw (err)
			else {
				db.collection('feedItems').updateOne({
					_id: feedItemId
				}, {
					$push: {
						'songs.spotify': {
							'index': feedItemData.songs.totalSongs,
							'_id': songId
						}
					},
					$inc: {
						'songs.totalSongs': 1
					}
				})
				cb(null, feedItemData)
			}
		})
	}

	app.put('/feeditem/:feeditemid/songlist', function (req, res) {
		if (typeof (req.body) === 'string') {
			var song = req.body.trim()
			var feedItemId = req.params.feeditemid
			addSong(
				new ObjectID(feedItemId), song, (err, feedItem) => {
					if (err) {
						res.status(500).send('Database error: ' + err)
					} else if (feedItem === null) {
						res.status(400).send('Could not find feeditem ' + feedItemId)
					} else {
						spotifyApi.getTracks([song])
							.then(function (data) {
								res.send(data.body)
							}, function (err) {
								spotifyApi.refreshAccessToken().then((data) => {
									console.log('access token refreshed!')
									spotifyApi.setAccessToken(data.body['access_token'])
									spotifyApi.getTracks([song])
										.then((data) => {
											res.send(data.body)
										}, (err) => {
											console.error(err)
											res.status(400).end()
										})
								}, (err) => {
									console.log('could not refresh access token', err)
								})
							})
					}
				})
		}
	})

	// removeSong:Spotify returns a list of track objects
	function removeSpotifySong(feedItemId, songId, cb) {
		db.collection('feedItems').findOne({
			_id: feedItemId
		}, (err, feedItemData) => {
			if (err) throw err
			else {
				var filtered = feedItemData.songs.spotify.filter(obj => obj._id === songId)[0]
				db.collection('feedItems').findOneAndUpdate({
					_id: feedItemId
				}, {
					$pull: {
						'songs.spotify': filtered
					},
					$inc: { 'songs.totalSongs': -1 }
				}, {
					returnOriginal: false
				}, (err, feedItem) => {
					if (err) throw err
					else cb(null, feedItem)
				})
			}
		})
	}

	app.delete('/feeditem/:feeditemid/songlist/:songId', function (req, res) {
		var song = req.params.songId.trim()
		var feedItem_id = req.params.feeditemid
		removeSpotifySong(new ObjectID(feedItem_id), song, (err, feedItemData) => {
			if (err) {
				res.status(500).send('Database err: ' + err)
			} else if (feedItemData === null) {
				res.status(400).send('Could not find feedItem ' + feedItem_id)
			} else {
				spotifyApi.getTracks([song])
					.then(function (data) {
						res.send(data.body)
					}, function (err) {
						console.error(err)
						res.status(400).end()
					})
			}
		})
	})

	// get group's songs from spotify
	app.get('/feeditem/:feeditemid/spotifysonglist', function (req, res) {
		var feeditem_id = req.params.feeditemid
		getFeedItem(new ObjectID(feeditem_id), function (err, feeditem) {
			if (err) {
				res.status(500).send('Database error: ' + err)
			} else if (feeditem === null) {
				res.status(400).send('Could not look up feeditem ' + feeditem_id)
			} else {
				var spotify = feeditem.songs.spotify
				var spotifyList = []
				for (var i = 0; i < spotify.length; ++i) {
					spotifyList.push(spotify[i]._id)
				}
				spotifyApi.getTracks(spotifyList)
					.then(function (data) {
						res.send(data.body.tracks)
					}, function (err) {
						spotifyApi.refreshAccessToken().then((data) => {
							console.log('access token refreshed!')
							spotifyApi.setAccessToken(data.body['access_token'])
							spotifyApi.getTracks(spotifyList)
								.then((data) => {
									res.send(data.body)
								}, (err) => {
									console.error(err)
									res.status(400).end()
								})
						}, (err) => {
							console.log('could not refresh access token', err)
						})
					})
			}
		})
	})

	// get group's songs from youtube
	app.get('/feeditem/:feeditemid/youtubesonglist', function (req, res) {
		var feeditem_id = req.params.feeditemid
		getFeedItem(new ObjectID(feeditem_id), function (err, feeditem) {
			if (err) {
				res.status(500).send('Database error: ' + err)
			} else if (feeditem === null) {
				res.status(400).send('Could not look up feeditem ' + feeditem_id)
			} else {
				var youtube = feeditem.songs.youtube
				var youtubeList = ''
				for (var i = 0; i < youtube.length; ++i) {
					youtubeList += youtube[i]._id + ', '
				}

				var service = google.youtube('v3')
				service.videos.list({
					id: youtubeList,
					part: 'snippet',
					key: process.env.YOUTUBE_API_KEY
				}, function (err, data) {
					if (err) {
						console.log('The API returned an error: ' + err)
						return
					}
					res.send(data.items)
				})
			}
		})
	})

	// get lyrics
	app.get('/lyrics/:platform/:songname/:artistname', (req, res) => {
		const songName = req.params.songname
		const artistName = req.params.artistname
		const platformType = req.params.platform
		const api_key = + process.env.MUSIXMATCH_API_KEY
		if (platformType === 'y') {
			axios.get('http://api.musixmatch.com/ws/1.1/track.search?q_track_artist=' + songName + '&s_artist_rating=asc&f_has_lyrics=1&apikey=' + api_key)
				.then((response) => {
					console.log(response.data.message.body.track_list[0].track)
					const track = response.data.message.body.track_list[0].track
					axios.get('http://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=' + track.track_id + '&apikey=' + api_key)
						.then((response) => {
							console.log(response.data.message.body.lyrics)
							if (response.data.message.body.lyrics !== undefined) {
								res.send(response.data.message.body.lyrics)
							} else {
								res.send({})
							}
						}).catch((err) => {
							console.log('can\'t get lyrics: ' + err)
						})
				}).catch((err) => {
					console.log(err)
				})
		} else {
			axios.get('http://api.musixmatch.com/ws/1.1/track.search?q_track=' + songName + '&q_artist=' + artistName + '&s_artist_rating=asc&f_has_lyrics=1&apikey=' + api_key)
				.then((response) => {
					console.log(response.data)
					const track = response.data.message.body.track_list[0].track
					axios.get('http://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=' + track.track_id + '&apikey=' + api_key)
						.then((response) => {
							console.log(response.data.message.body.lyrics)
							if (response.data.message.body.lyrics !== undefined) {
								res.send(response.data.message.body.lyrics)
							} else {
								res.send({})
							}
						}).catch((err) => {
							console.log('can\'t get lyrics: ' + err)
						})
				}).catch((err) => {
					console.log(err)
				})
		}		
	})

	// addYoutubeSong returns a list of track objects
	function addYoutubeSong(feedItemId, songId, cb) {
		db.collection('feedItems').findOne({
			_id: feedItemId
		}, (err, feedItemData) => {
			if (err) throw err
			else {
				db.collection('feedItems').updateOne({
					_id: feedItemId
				}, {
					$push: {
						'songs.youtube': {
							'index': feedItemData.songs.totalSongs,
							'_id': songId
						}
					},
					$inc: {
						'songs.totalSongs': 1
					}
				})
				cb(null, feedItemData)
			}
		})
	}

	app.put('/feeditem/:feeditemid/youtubesonglist', function (req, res) {
		if (typeof (req.body) === 'string') {
			var song = req.body.trim()
			var feedItemId = req.params.feeditemid
			addYoutubeSong(
				new ObjectID(feedItemId), song, (err, feedItemData) => {
					if (err) {
						res.status(500).send('Database err: ' + err)
					} else if (feedItemData === null) {
						res.status(400).send('Could not find feedItem ' + feedItemId)
					}
				})
			var service = google.youtube('v3')
			service.videos.list({
				id: song,
				part: 'snippet',
				key: process.env.YOUTUBE_API_KEY
			}, function (err, data) {
				if (err) {
					console.log('The API returned an error: ' + err)
					return
				}
				res.send(data.items)
			})
		}
	})

	/**
  * Get the user ID from a token. Returns -1 (an invalid ID)
  * if it fails.
  */
	function getUserIdFromToken(authorizationLine) {
		try {
			// Cut off 'Bearer ' from the header value.
			var token = authorizationLine.slice(7)
			// Convert the base64 string to a UTF-8 string.
			var regularString = new Buffer(token, 'base64').toString('utf8')
			// Convert the UTF-8 string into a JavaScript object.
			var tokenObj = JSON.parse(regularString)
			var id = tokenObj['id']
			// Check that id is a number.
			if (typeof id === 'string') {
				return id
			} else {
				// Not a number. Return -1, an invalid ID.
				return -1
			}
		} catch (e) {
			// Return an invalid ID.
			return -1
		}
	}

	/**
  * Translate JSON Schema Validation failures into error 400s.
  */
	app.use(function (err, req, res, next) {
		if (err.name === 'JsonSchemaValidation') {
			// Set a bad request http response status
			res.status(400).end()
		} else {
			// It's some other sort of error; pass it to next error middleware handler
			next(err)
		}
	})
})
