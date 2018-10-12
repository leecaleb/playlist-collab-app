import React from 'react'
import { getLyrics } from '../server'

export default class NavBar extends React.Component {
	constructor(props) {
		super(props)
		this.test = this.test.bind(this)
	}

	test() {
		getLyrics()
	}

	render() {
		return (
			<div>
				<nav className="navbar navbar-inverse navbar-fixed-top">
					<div className="container-fluid">
						<div className="navbar-header">
							<button type="button" className="navbar-toggle collapsed" data-toggle="collapse" data-target="#bs-example-navbar-collapse-1" aria-expanded="false">
								<span className="sr-only">Toggle navigation</span>
								<span className="icon-bar"></span>
								<span className="icon-bar"></span>
								<span className="icon-bar"></span>
							</button>
							<a className="navbar-brand" href="#">QueueApp</a>
						</div>

						<div className="collapse navbar-collapse" id="bs-example-navbar-collapse-1">
							<form className="navbar-form navbar-left">
								<div className="form-group row">
									<input type="text" className="form-control" placeholder="Search" />
								</div>
								<button type="button" className="btn btn-default" onClick={this.test}>Submit</button>
							</form>
							<ul className="nav navbar-nav navbar-right">
								<li><a href="#">
									<span className="glyphicon glyphicon-plus" aria-hidden="true"></span>
								</a></li>
								<li><a href="#">
									<span className="glyphicon glyphicon-envelope" aria-hidden="true"></span>
								</a></li>
								<li><a href="#">
									<span className="glyphicon glyphicon-user" aria-hidden="true"></span>
								</a></li>
							</ul>
						</div>
					</div>
				</nav>
			</div>
		)
	}
}
