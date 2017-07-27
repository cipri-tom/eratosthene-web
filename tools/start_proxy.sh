#!/bin/bash

# WEB_PORT='11025' # archeology -- single times
# WEB_PORT='11021' # stable -- 2 times and operators
# WEB_PORT='11031' # WIP do not use
WEB_PORT='11027'   # unstable -- 11027
LOCAL_IP='127.0.0.1'

# external addr
websockify "$LOCAL_IP:$WEB_PORT" 149.202.222.194:"$WEB_PORT"
